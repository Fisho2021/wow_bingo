from django.utils import timezone
from django.conf import settings
from django.db import transaction
from telegram import (
    Update, BotCommand, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup,
    ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove
)
from telegram.ext import ContextTypes, ConversationHandler
from asgiref.sync import sync_to_async
import random
import string
import re

from .models import TelegramUser, Cartela, GameRound, DepositRequest, WithdrawalRequest, Transaction

ADMIN_TELEGRAM_IDS = getattr(settings, 'ADMIN_TELEGRAM_IDS', [])


def get_or_create_user(telegram_id, username, first_name):
    # 👇 SAFE VERSION: Handles MultipleObjectsReturned
    try:
        user, _ = TelegramUser.objects.get_or_create(
            telegram_id=telegram_id,
            defaults={'username': username or '', 'first_name': first_name or ''}
        )
        return user
    except TelegramUser.MultipleObjectsReturned:
        # If duplicates exist, just grab the first one
        return TelegramUser.objects.filter(telegram_id=telegram_id).first()



def build_main_menu():
    url = settings.TELEGRAM_WEBAPP_URL
    keyboard = [
        [InlineKeyboardButton("Play 🎮", web_app=WebAppInfo(url=url))],
        [
            InlineKeyboardButton("Balance 💰", callback_data="menu_balance"),
            InlineKeyboardButton("Deposit 💸", callback_data="menu_deposit")
        ],
        [
            InlineKeyboardButton("Contact Support...", url="https://t.me/YourSupportUsername"),
            InlineKeyboardButton("Instruction 📖", callback_data="menu_instruction")
        ],
        [
            InlineKeyboardButton("Transfer 🎁", callback_data="menu_transfer"),
            InlineKeyboardButton("Withdraw 🤯", callback_data="menu_withdraw")
        ],
        [InlineKeyboardButton("Invite 🔗", callback_data="menu_invite")]
    ]
    return InlineKeyboardMarkup(keyboard)


# ═══ START & REGISTRATION ═══
async def start(update, context):
    u = update.effective_user
    user = await sync_to_async(get_or_create_user)(u.id, u.username, u.first_name)

    if not user.phone_number:
        keyboard = [[KeyboardButton("📞 Share contact", request_contact=True)]]
        reply_markup = ReplyKeyboardMarkup(keyboard, one_time_keyboard=True, resize_keyboard=True)
        await update.message.reply_text(
            "👋 Welcome! Please share your contact to start playing.",
            reply_markup=reply_markup
        )
        return

    await update.message.reply_text("🎱 Main Menu", reply_markup=build_main_menu())


async def handle_contact(update, context):
    contact = update.message.contact
    u = update.effective_user

    if contact.user_id != u.id:
        await update.message.reply_text("❌ Please share your OWN contact using the button.")
        return

    def process_contact():
        with transaction.atomic():
            user = TelegramUser.objects.select_for_update().get(telegram_id=u.id)
            user.phone_number = contact.phone_number
            if user.balance == 0.0:
                user.balance += 10.0
            user.save()
            return user

    await sync_to_async(process_contact)()
    await update.message.reply_text("✅ ተመዝግበዋል! የ 10 ብር ስምና ተሰጥቷታል::", reply_markup=ReplyKeyboardRemove())
    await update.message.reply_text("🎱 Main Menu", reply_markup=build_main_menu())


# ═══ DEPOSIT CONVERSATION ═══
DEPOSIT_AMOUNT, DEPOSIT_REF = range(2)


async def deposit_start(update, context):
    u = update.effective_user
    await sync_to_async(get_or_create_user)(u.id, u.username, u.first_name)

    text = "💸 How much birr would you like to deposit? (Min 100)"
    if update.callback_query:
        await update.callback_query.message.reply_text(text, reply_markup=ReplyKeyboardRemove())
        await update.callback_query.answer()
    else:
        await update.message.reply_text(text, reply_markup=ReplyKeyboardRemove())
    return DEPOSIT_AMOUNT


async def deposit_amount(update, context):
    try:
        amount = float(update.message.text)
        if amount < 100.0:
            await update.message.reply_text("❌ Minimum deposit is 100 birr. Please enter a valid amount:")
            return DEPOSIT_AMOUNT
    except:
        await update.message.reply_text("❌ Invalid amount. Please enter a number:")
        return DEPOSIT_AMOUNT

    context.user_data['deposit_amount'] = amount

    admin_phone = getattr(settings, 'ADMIN_PHONE', '0911223344')
    admin_name = getattr(settings, 'ADMIN_NAME', 'Admin')

    msg = (
        f"✅ Amount: {amount} birr\n\n"
        f"Please send exactly *{amount} birr* to:\n"
        f"👤 Name: *{admin_name}*\n"
        f"📱 Phone: `{admin_phone}`\n\n"
        f"After sending, please paste the **Telebirr SMS** here (or type the Reference Number starting with DJ):"
    )
    await update.message.reply_text(msg, parse_mode='Markdown')
    return DEPOSIT_REF


async def deposit_reference(update, context):
    if not update.message.text:
        await update.message.reply_text(
            "❌ Please paste the SMS text or type the Reference Number (e.g., DJ12345678). Do NOT send a screenshot.")
        return DEPOSIT_REF

    user_text = update.message.text.strip()

    match = re.search(r'(DJ[A-Za-z0-9]+)', user_text, re.IGNORECASE)

    if not match:
        await update.message.reply_text(
            "❌ I couldn't find a valid Reference Number starting with 'DJ'.\nPlease paste the SMS text or type the exact code again.")
        return DEPOSIT_REF

    extracted_ref = match.group(1).upper()
    amount = context.user_data.get('deposit_amount')

    # 👇 NEW: Check for duplicates and handle DB errors
    def save_deposit():
        # Check if reference already exists
        if DepositRequest.objects.filter(reference_number=extracted_ref).exists():
            return "used", None

        try:
            u = update.effective_user
            user, _ = TelegramUser.objects.get_or_create(
                telegram_id=u.id,
                defaults={'username': u.username or '', 'first_name': u.first_name or ''}
            )
            dep = DepositRequest.objects.create(user=user, amount=amount, reference_number=extracted_ref)
            return "success", dep
        except Exception as e:
            print(f"❌ DJONGO DB ERROR in deposit: {e}")
            return "error", None

    status, deposit = await sync_to_async(save_deposit)()

    if status == "used":
        await update.message.reply_text(
            f"❌ The reference number `{extracted_ref}` has already been used.\n\n"
            f"Please deposit new money and send a new Reference Number.",
            parse_mode='Markdown'
        )
        return DEPOSIT_REF  # Ask again

    elif status == "error":
        await update.message.reply_text("❌ A database error occurred. Please try again or contact support.")
        return ConversationHandler.END

    # Success
    await update.message.reply_text(
        f"✅ Deposit request for {amount} birr submitted!\nRef: `{extracted_ref}`\nThe admin will verify and approve it shortly.",
        reply_markup=build_main_menu(), parse_mode='Markdown')

    admin_msg = (
        f"🚨 *NEW DEPOSIT REQUEST*\n\n"
        f"👤 User: {deposit.user.nickname or deposit.user.first_name}\n"
        f"🆔 Telegram ID: `{deposit.user.telegram_id}`\n"
        f"💰 Amount: *{deposit.amount} birr*\n"
        f"🧾 Ref: `{deposit.reference_number}`\n\n"
        f"Please check your Telebirr/CBE account to verify this transaction."
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Approve", callback_data=f"app_dep_{deposit.id}"),
            InlineKeyboardButton("❌ Reject", callback_data=f"rej_dep_{deposit.id}")
        ]
    ])

    for admin_id in ADMIN_TELEGRAM_IDS:
        try:
            await context.bot.send_message(chat_id=admin_id, text=admin_msg, parse_mode='Markdown',
                                           reply_markup=keyboard)
            print(f"✅ Successfully sent deposit alert to admin {admin_id}")
        except Exception as e:
            print(f"❌ FAILED to send to admin {admin_id}. REASON: {e}")

    return ConversationHandler.END


# ═══ WITHDRAW CONVERSATION ═══
WITHDRAW_AMOUNT, WITHDRAW_NAME, WITHDRAW_PHONE = range(3)


async def withdraw_start(update, context):
    u = update.effective_user
    await sync_to_async(get_or_create_user)(u.id, u.username, u.first_name)

    text = "💸 How much birr would you like to withdraw? (Min 100)"
    if update.callback_query:
        await update.callback_query.message.reply_text(text, reply_markup=ReplyKeyboardRemove())
        await update.callback_query.answer()
    else:
        await update.message.reply_text(text, reply_markup=ReplyKeyboardRemove())
    return WITHDRAW_AMOUNT


async def withdraw_amount(update, context):
    try:
        amount = float(update.message.text)
        if amount < 100.0:
            await update.message.reply_text("❌ Minimum withdrawal is 100 birr. Enter valid amount:")
            return WITHDRAW_AMOUNT
        context.user_data['withdraw_amount'] = amount
    except:
        await update.message.reply_text("❌ Invalid amount. Enter a number:")
        return WITHDRAW_AMOUNT

    await update.message.reply_text("👤 Please enter your Full Name for the payout:")
    return WITHDRAW_NAME


async def withdraw_name(update, context):
    name = update.message.text.strip()
    if len(name) < 2:
        await update.message.reply_text("❌ Please enter a valid full name.")
        return WITHDRAW_NAME
    context.user_data['withdraw_name'] = name

    await update.message.reply_text(
        "📱 Please enter your phone number (must start with 09 and be exactly 10 digits, e.g., 0912345678):")
    return WITHDRAW_PHONE


async def withdraw_phone(update, context):
    phone = update.message.text.strip()

    if not re.match(r'^09\d{8}$', phone):
        await update.message.reply_text(
            "❌ Invalid phone number.\nIt must start with `09` and be exactly 10 digits (e.g., 0912345678). Try again:",
            parse_mode='Markdown')
        return WITHDRAW_PHONE

    amount = context.user_data.get('withdraw_amount')
    name = context.user_data.get('withdraw_name')

    def process_withdraw():
        with transaction.atomic():
            u = update.effective_user
            user, _ = TelegramUser.objects.get_or_create(
                telegram_id=u.id,
                defaults={'username': u.username or '', 'first_name': u.first_name or ''}
            )

            locked_user = TelegramUser.objects.select_for_update().get(id=user.id)

            if locked_user.balance < amount:
                return None

            locked_user.balance -= amount
            locked_user.save()
            wr = WithdrawalRequest.objects.create(user=locked_user, amount=amount, phone_number=phone, name=name)
            Transaction.objects.create(user=locked_user, amount=-amount, type='withdraw', note=f"Withdrawal to {phone}")
            return wr

    withdraw_req = await sync_to_async(process_withdraw)()

    if not withdraw_req:
        await update.message.reply_text("❌ Insufficient balance.", reply_markup=build_main_menu())
        return ConversationHandler.END

    await update.message.reply_text(f"✅ Withdrawal of {amount} birr requested!\nAdmin will process it shortly.",
                                    reply_markup=build_main_menu())

    admin_msg = (
        f"🚨 *NEW WITHDRAWAL REQUEST*\n\n"
        f"👤 User: {withdraw_req.user.nickname or withdraw_req.user.first_name}\n"
        f"🆔 Telegram ID: `{withdraw_req.user.telegram_id}`\n"
        f"💵 Amount: *{withdraw_req.amount} birr*\n"
        f"📝 Name: {withdraw_req.name}\n"
        f"📱 Phone: `{withdraw_req.phone_number}`\n\n"
        f"Please send the money to the user's phone number, then click Approve."
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Approve & Paid", callback_data=f"app_wit_{withdraw_req.id}"),
            InlineKeyboardButton("❌ Reject", callback_data=f"rej_wit_{withdraw_req.id}")
        ]
    ])

    for admin_id in ADMIN_TELEGRAM_IDS:
        try:
            await context.bot.send_message(chat_id=admin_id, text=admin_msg, parse_mode='Markdown',
                                           reply_markup=keyboard)
        except Exception as e:
            print(f"❌ Failed to send to admin {admin_id}: {e}")

    return ConversationHandler.END


async def cancel_conv(update, context):
    await update.message.reply_text("Cancelled.", reply_markup=build_main_menu())
    return ConversationHandler.END


# ═══ ADMIN APPROVAL HANDLER ═══
async def admin_action_callback(update, context):
    query = update.callback_query
    await query.answer()

    if update.effective_user.id not in ADMIN_TELEGRAM_IDS:
        await query.answer("❌ You are not an admin.", show_alert=True)
        return

    data = query.data

    # --- DEPOSIT HANDLING ---
    if data.startswith("app_dep_"):
        dep_id = int(data.split("_")[2])

        def approve():
            with transaction.atomic():
                dep = DepositRequest.objects.select_for_update().get(id=dep_id)
                if dep.status == 'pending':
                    dep.status = 'approved'
                    dep.save()
                    user = dep.user
                    user.balance += dep.amount
                    user.save()
                    Transaction.objects.create(user=user, amount=dep.amount, type='deposit',
                                               note=f"Deposit Ref: {dep.reference_number}")
                    return dep, True
                return dep, False

        dep, success = await sync_to_async(approve)()
        if success:
            await query.edit_message_text(f"✅ Approved deposit of {dep.amount} birr for {dep.user.first_name}.")
            try:
                await context.bot.send_message(chat_id=dep.user.telegram_id,
                                               text=f"✅ *Deposit Approved!*\nYour deposit of {dep.amount} birr has been added to your wallet.",
                                               parse_mode='Markdown')
            except:
                pass
        else:
            await query.edit_message_text("⚠️ This deposit was already processed.")

    elif data.startswith("rej_dep_"):
        dep_id = int(data.split("_")[2])

        def reject():
            dep = DepositRequest.objects.get(id=dep_id)
            if dep.status == 'pending':
                dep.status = 'rejected'
                dep.save()
                return dep, True
            return dep, False

        dep, success = await sync_to_async(reject)()
        if success:
            await query.edit_message_text(f"❌ Rejected deposit for {dep.user.first_name}.")
            try:
                await context.bot.send_message(chat_id=dep.user.telegram_id,
                                               text=f"❌ *Deposit Rejected*\nYour deposit request for {dep.amount} birr was rejected.",
                                               parse_mode='Markdown')
            except:
                pass
        else:
            await query.edit_message_text("⚠️ This deposit was already processed.")

    # --- WITHDRAWAL HANDLING ---
    elif data.startswith("app_wit_"):
        wit_id = int(data.split("_")[2])

        def approve_wit():
            wit = WithdrawalRequest.objects.get(id=wit_id)
            if wit.status == 'pending':
                wit.status = 'approved'
                wit.save()
                return wit, True
            return wit, False

        wit, success = await sync_to_async(approve_wit)()
        if success:
            await query.edit_message_text(f"✅ Marked withdrawal of {wit.amount} birr as PAID to {wit.name}.")
            try:
                await context.bot.send_message(chat_id=wit.user.telegram_id,
                                               text=f"✅ *Withdrawal Paid!*\nYour withdrawal of {wit.amount} birr has been sent to {wit.phone_number}.",
                                               parse_mode='Markdown')
            except:
                pass
        else:
            await query.edit_message_text("⚠️ This withdrawal was already processed.")

    elif data.startswith("rej_wit_"):
        wit_id = int(data.split("_")[2])

        def reject_wit():
            with transaction.atomic():
                wit = WithdrawalRequest.objects.select_for_update().get(id=wit_id)
                if wit.status == 'pending':
                    wit.status = 'rejected'
                    wit.save()
                    user = wit.user
                    user.balance += wit.amount
                    user.save()
                    Transaction.objects.create(user=user, amount=wit.amount, type='refund',
                                               note="Withdrawal rejected refund")
                    return wit, True
                return wit, False

        wit, success = await sync_to_async(reject_wit)()
        if success:
            await query.edit_message_text(f"❌ Rejected withdrawal for {wit.user.first_name}. Funds refunded.")
            try:
                await context.bot.send_message(chat_id=wit.user.telegram_id,
                                               text=f"❌ *Withdrawal Rejected*\nYour request was rejected and {wit.amount} birr was refunded to your wallet.",
                                               parse_mode='Markdown')
            except:
                pass
        else:
            await query.edit_message_text("⚠️ This withdrawal was already processed.")


# ═══ INLINE MENU CALLBACKS ═══
async def menu_callback(update, context):
    query = update.callback_query

    if query.data == "menu_balance":
        await query.answer()
        u = update.effective_user
        user = await sync_to_async(get_or_create_user)(u.id, u.username, u.first_name)
        await query.message.reply_text(f"💰 Balance: *{user.balance} birr*", parse_mode='Markdown')

    elif query.data == "menu_instruction":
        await query.answer()
        await query.message.reply_text(
            "📖 *How to play:*\n1. Buy cartelas.\n2. Wait for countdown.\n3. Tap numbers.\n4. Make a line and press BINGO!",
            parse_mode='Markdown')

    elif query.data == "menu_transfer":
        await query.answer()
        await query.message.reply_text("🎁 Transfer feature coming soon!")

    elif query.data == "menu_invite":
        await query.answer()
        u = update.effective_user
        user = await sync_to_async(get_or_create_user)(u.id, u.username, u.first_name)
        link = f"https://t.me/jofishbingo_bot?start=ref_{user.telegram_id}"
        await query.message.reply_text(f"🔗 Invite Link:\n`{link}`", parse_mode='Markdown')


# ═══ COMMAND ALIASES ═══
async def play(update, context): await update.message.reply_text("🎱 Main Menu", reply_markup=build_main_menu())


async def register(update, context): await start(update, context)


async def support(update, context): await update.message.reply_text("Contact support: @bubaby")


async def instruction(update, context): await update.message.reply_text(
    "📖 Tap Play, buy a cartela, tap numbers, and shout BINGO!")


async def invite(update, context):
    user = await sync_to_async(get_or_create_user)(update.effective_user.id, update.effective_user.username,
                                                   update.effective_user.first_name)
    link = f"https://t.me/jofishbingo_bot?start=ref_{user.telegram_id}"
    await update.message.reply_text(f"🔗 Your Invite Link:\n`{link}`", parse_mode='Markdown')


async def transfer(update, context): await update.message.reply_text("Transfer feature coming soon.")


async def register_commands(app):
    await app.bot.set_my_commands([
        BotCommand("start", "Start"), BotCommand("register", "Register"),
        BotCommand("play", "Play"), BotCommand("deposit", "Deposit"),
        BotCommand("balance", "Balance"), BotCommand("withdraw", "Withdraw"),
        BotCommand("invite", "Invite Friends"), BotCommand("transfer", "Transfer"),
        BotCommand("instruction", "Instruction"), BotCommand("support", "Support"),
    ])
