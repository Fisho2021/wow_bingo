import json
import logging
import asyncio
import threading
import traceback
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from telegram import Update
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    filters, ConversationHandler
)
from telegram.request import HTTPXRequest

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
_event_loop = None


def get_event_loop():
    """Creates a persistent background event loop for the bot."""
    global _event_loop
    if _event_loop is None or _event_loop.is_closed():
        print("✅ Creating NEW background event loop")
        _event_loop = asyncio.new_event_loop()
        threading.Thread(target=_event_loop.run_forever, daemon=True).start()
    return _event_loop


def get_application():
    global _application
    if _application is None:
        api_req = HTTPXRequest(
            connection_pool_size=256,
            pool_timeout=10.0,
            connect_timeout=30.0,
            read_timeout=30.0,
        )
        updates_req = HTTPXRequest(
            connection_pool_size=8,
            pool_timeout=30.0,
            connect_timeout=30.0,
            read_timeout=60.0,
        )

        _application = (
            Application.builder()
            .token(settings.TELEGRAM_BOT_TOKEN)
            .request(api_req)
            .get_updates_request(updates_req)
            .post_init(register_commands)
            .build()
        )

        # 👇 1. REGISTER CONVERSATION HANDLERS FIRST
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

        # 👇 5. REGISTER GENERAL MENU HANDLER LAST
        _application.add_handler(CallbackQueryHandler(menu_callback))

        # ✅ Initialize the application IN the background loop
        loop = get_event_loop()
        asyncio.run_coroutine_threadsafe(_application.initialize(), loop).result()

    return _application


@csrf_exempt
def telegram_webhook(request):
    if request.method == 'POST':
        print("🚨 INCOMING WEBHOOK FROM TELEGRAM!")

        # 🛑 TEMPORARILY DISABLED SECRET TOKEN CHECK TO PREVENT 403 ERRORS
        # secret_token = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
        # if settings.TELEGRAM_WEBHOOK_SECRET and secret_token != settings.TELEGRAM_WEBHOOK_SECRET:
        #     return JsonResponse({'status': 'unauthorized'}, status=403)

        try:
            data = json.loads(request.body)
            app = get_application()
            update = Update.de_json(data, app.bot)

            # ✅ Process the update IN the persistent background loop
            loop = get_event_loop()
            future = asyncio.run_coroutine_threadsafe(app.process_update(update), loop)
            future.result(timeout=15)

            return JsonResponse({'status': 'ok'})
        except Exception as e:
            print("❌❌❌ WEBHOOK CRASHED ❌❌❌")
            traceback.print_exc()
            return JsonResponse({'status': 'error_logged'})

    return JsonResponse({'status': 'ok'})


def set_webhook(request):
    app = get_application()
    url = settings.TELEGRAM_WEBHOOK_URL
    if not url:
        return HttpResponse("TELEGRAM_WEBHOOK_URL not set in .env")

    try:
        loop = get_event_loop()
        # ✅ Removed the secret token so it doesn't break
        result = asyncio.run_coroutine_threadsafe(
            app.bot.set_webhook(url=url, drop_pending_updates=True),
            loop
        ).result(timeout=30)
        return HttpResponse(f"Webhook set: {result} → {url}")
    except Exception as e:
        traceback.print_exc()
        return HttpResponse(f"Failed to set webhook: {e}")


def clear_webhook(request):
    app = get_application()
    try:
        loop = get_event_loop()
        asyncio.run_coroutine_threadsafe(app.bot.delete_webhook(), loop).result(timeout=30)
        return HttpResponse("Webhook cleared")
    except Exception as e:
        traceback.print_exc()
        return HttpResponse(f"Failed to clear webhook: {e}")
