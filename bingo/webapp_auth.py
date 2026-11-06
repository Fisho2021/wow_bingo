import hashlib
import hmac
import json
from urllib.parse import parse_qsl
from django.conf import settings
from django.http import JsonResponse
from functools import wraps
from .models import TelegramUser


def verify_init_data(init_data: str, bot_token: str):
    """
    Verify Telegram WebApp initData.
    Returns (is_valid, parsed_dict) where parsed_dict includes 'user' as a dict.
    """
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        return False, {}

    received_hash = parsed.pop('hash', '')
    if not received_hash:
        return False, {}

    data_check_string = '\n'.join(f"{k}={v}" for k, v in sorted(parsed.items()))

    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        return False, {}

    # Parse user JSON
    if 'user' in parsed:
        try:
            parsed['user'] = json.loads(parsed['user'])
        except json.JSONDecodeError:
            return False, {}

    return True, parsed


def webapp_auth_required(view_func):
    """Decorator: authenticate the request using Telegram initData."""

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        # ✅ FIXED: Look for the Authorization header first (TgWebApp <token>)
        auth_header = request.headers.get('Authorization', '')

        if auth_header.startswith('TgWebApp '):
            init_data = auth_header[len('TgWebApp '):]
        else:
            # Fallback to old headers if the cache hasn't updated yet
            init_data = (
                    request.headers.get('X-Telegram-Init-Data')
                    or request.GET.get('initData')
                    or ''
            )

        if not init_data or not init_data.strip():
            return JsonResponse({'ok': False, 'error': 'missing_init_data'}, status=401)

        is_valid, parsed = verify_init_data(init_data, settings.TELEGRAM_BOT_TOKEN)
        if not is_valid:
            return JsonResponse({'ok': False, 'error': 'invalid_init_data'}, status=401)

        user_data = parsed.get('user', {})
        if not user_data.get('id'):
            return JsonResponse({'ok': False, 'error': 'no_user_in_init_data'}, status=401)

        user, _ = TelegramUser.objects.get_or_create(
            telegram_id=user_data['id'],
            defaults={
                'username': user_data.get('username', ''),
                'first_name': user_data.get('first_name', ''),
            }
        )
        request.tg_user = user
        return view_func(request, *args, **kwargs)

    return wrapper
