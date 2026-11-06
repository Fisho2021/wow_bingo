from django.contrib import admin
from django.urls import path
from django.http import HttpResponse
from bingo.views import telegram_webhook, set_webhook, clear_webhook

urlpatterns = [

    path('admin/', admin.site.urls),
    path('webhook/', telegram_webhook, name='telegram_webhook'),
    path('set-webhook/', set_webhook),
    path('clear-webhook/', clear_webhook),

]