from django.contrib import admin
from django.urls import path
from django.http import HttpResponse
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static

from bingo.views import telegram_webhook, set_webhook, clear_webhook
from bingo import api


def home(request):
    return HttpResponse("🎱 Bingo bot is running.")


urlpatterns = [
    path('', home),
    path('admin/', admin.site.urls),
    path('webhook/', telegram_webhook),
    path('set-webhook/', set_webhook),
    path('clear-webhook/', clear_webhook),

    # 👇 MINI APP PAGES
    path('app/', TemplateView.as_view(template_name='miniapp/menu.html'), name='app_menu'),
    path('app/cartelas/', TemplateView.as_view(template_name='miniapp/cartelas.html'), name='app_cartelas'),
    path('app/game/', TemplateView.as_view(template_name='miniapp/game.html'), name='app_game'),
    path('app/scores/', TemplateView.as_view(template_name='miniapp/scores.html'), name='app_scores'),
    path('app/history/', TemplateView.as_view(template_name='miniapp/history.html'), name='app_history'),
    path('app/wallet/', TemplateView.as_view(template_name='miniapp/wallet.html'), name='app_wallet'),
    path('app/profile/', TemplateView.as_view(template_name='miniapp/profile.html'), name='app_profile'),

    # API ROUTES
    path('api/me/', api.me),
    path('api/dashboard/', api.dashboard_state),
    path('api/cartelas/', api.list_cartelas),
    path('api/cartelas/toggle/', api.toggle_cartela),  # 👈 Instant Buy/Release
    path('api/game/', api.game_state),
    path('api/player/<int:player_id>/mark/', api.toggle_mark),
    path('api/bingo/', api.claim_bingo),
    path('api/scores/', api.scores),
    path('api/history/', api.history),
    path('api/wallet/', api.wallet),
    #path('api/redeem/', api.redeem_coupon),
    path('api/me/nickname/', api.update_nickname),
    path('api/deposit/', api.request_deposit),
    path('api/withdraw/', api.request_withdrawal),
    path('api/referrals/', api.get_referrals),

    # 👇 ADMIN ROUTES
    path('app/admin/', TemplateView.as_view(template_name='miniapp/admin.html'), name='app_admin'),
    path('api/admin/stats/', api.admin_stats),
    path('api/admin/requests/', api.admin_requests),
    path('api/admin/action/', api.admin_action),
    path('api/admin/force-start/', api.admin_force_start),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATICFILES_DIRS[0])
