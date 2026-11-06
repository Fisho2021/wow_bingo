# yourapp/middleware.py
from django.conf import settings
from django.http import JsonResponse
from .webapp_auth import verify_init_data  # 👈 Import your native validation function


class TelegramOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # ONLY protect API endpoints. Do NOT protect /app/ HTML pages.
        if request.path.startswith('/api/'):

            # 1. Look for the Authorization header
            auth_header = request.headers.get('Authorization', '')

            if auth_header.startswith('TgWebApp '):
                init_data_raw = auth_header[len('TgWebApp '):]
            else:
                # Fallback just in case
                init_data_raw = request.headers.get('X-Telegram-Init-Data', '')

            # 2. Block if missing
            if not init_data_raw or not init_data_raw.strip():
                return JsonResponse({'ok': False, 'error': 'Missing or invalid Authorization header'}, status=403)

            # 3. Validate using the exact same function as your decorator
            is_valid, _ = verify_init_data(init_data_raw, settings.TELEGRAM_BOT_TOKEN)

            if not is_valid:
                return JsonResponse({'ok': False, 'error': 'Invalid Telegram initData'}, status=403)

        return self.get_response(request)