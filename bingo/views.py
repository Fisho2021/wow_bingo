import json
import logging
from asgiref.sync import async_to_sync
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ConversationHandler

from .bot_handlers import (
    start, play, handle_contact, menu_callback, register_commands,
    deposit_start, deposit_amount, deposit_reference,
    withdraw_start, withdraw_amount, withdraw_name, withdraw_phone, cancel_conv,
    DEPOSIT_AMOUNT, DEPOSIT_REF, WITHDRAW_AMOUNT, WITHDRAW_NAME, WITHDRAW_PHONE,
    register, support, instruction, invite, transfer,
    admin_action_callback
)

logger = logging.getLogger(__name__)
_application = None


def get_application():
    global _application
    if _application is None:
        _application = (
            Application.builder()
            .token(settings.TELEGRAM_BOT_TOKEN)
            .read_timeout(30)
            .write_timeout(30)
            .connect_timeout(30)
            .pool_timeout(30)
            .post_init(register_commands)
            .build()
        )

        # 👇 1. REGISTER CONVERSATION HANDLERS FIRST (So buttons are caught)
        dep_conv = ConversationHandler(
            entry_points=[
                CommandHandler("deposit", deposit_start),
                CallbackQueryHandler(deposit_start, pattern="^menu_deposit$")
            ],
            states={
                DEPOSIT_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, deposit_amount)],
                DEPOSIT_REF: [MessageHandler(filters.TEXT & ~filters.COMMAND, deposit_reference)],
            },
            fallbacks=[CommandHandler("cancel", cancel_conv)],
        )

        wit_conv = ConversationHandler(
            entry_points=[
                CommandHandler("withdraw", withdraw_start),
                CallbackQueryHandler(withdraw_start, pattern="^menu_withdraw$")
            ],
            states={
                WITHDRAW_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_amount)],
                WITHDRAW_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_name)],
                WITHDRAW_PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_phone)],
            },
            fallbacks=[CommandHandler("cancel", cancel_conv)],
        )

        _application.add_handler(dep_conv)
        _application.add_handler(wit_conv)

        # 👇 2. REGISTER COMMANDS
        _application.add_handler(CommandHandler("start", start))
        _application.add_handler(CommandHandler("register", register))
        _application.add_handler(CommandHandler("play", play))
        _application.add_handler(CommandHandler("balance", play))
        _application.add_handler(CommandHandler("invite", invite))
        _application.add_handler(CommandHandler("transfer", transfer))
        _application.add_handler(CommandHandler("instruction", instruction))
        _application.add_handler(CommandHandler("support", support))

        # 👇 3. REGISTER CONTACT HANDLER
        _application.add_handler(MessageHandler(filters.CONTACT, handle_contact))

        # 👇 4. REGISTER ADMIN ACTION HANDLER
        _application.add_handler(
            CallbackQueryHandler(admin_action_callback, pattern="^(app_dep_|rej_dep_|app_wit_|rej_wit_)"))

        # 👇 5. REGISTER GENERAL MENU HANDLER LAST (Fallback for other buttons)
        _application.add_handler(CallbackQueryHandler(menu_callback))

    return _application


@csrf_exempt
def telegram_webhook(request):
    if request.method == 'POST':
        secret_token = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
        if settings.TELEGRAM_WEBHOOK_SECRET and secret_token != settings.TELEGRAM_WEBHOOK_SECRET:
            return JsonResponse({'status': 'unauthorized'}, status=403)

        try:
            data = json.loads(request.body)
            app = get_application()
            update = Update.de_json(data, app.bot)
            async_to_sync(app.process_update)(update)
        except Exception as e:
            logger.exception(f"Webhook error: {e}")
            return JsonResponse({'status': 'error'}, status=500)
    return JsonResponse({'status': 'ok'})


def set_webhook(request):
    app = get_application()
    url = settings.TELEGRAM_WEBHOOK_URL
    if not url:
        return HttpResponse("TELEGRAM_WEBHOOK_URL not set in .env")
    result = async_to_sync(app.bot.set_webhook)(url=url, secret_token=settings.TELEGRAM_WEBHOOK_SECRET)
    return HttpResponse(f"Webhook set: {result} → {url}")


def clear_webhook(request):
    app = get_application()
    async_to_sync(app.bot.delete_webhook)()
    return HttpResponse("Webhook cleared")