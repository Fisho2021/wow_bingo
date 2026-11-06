from django.contrib import admin
from .models import TelegramUser, Cartela, GameRound


@admin.register(TelegramUser)
class TelegramUserAdmin(admin.ModelAdmin):
    list_display = ('telegram_id', 'first_name', 'username', 'balance', 'created_at')
    search_fields = ('telegram_id', 'username', 'first_name')
    list_editable = ('balance',)


    @admin.action(description="Generate 10 new coupons (1 birr each)")
    def generate_coupons(self, request, queryset):
        for _ in range(10):
            Coupon.objects.create(code=Coupon.generate_code(), value=1.00)
        self.message_user(request, "10 coupons created.")


@admin.register(Cartela)
class CartelaAdmin(admin.ModelAdmin):
    list_display = ('cartela_number', 'is_sold', 'created_at')
    list_filter = ('is_sold',)


@admin.register(GameRound)
class GameRoundAdmin(admin.ModelAdmin):
    list_display = ('round_number', 'status', 'prize_pool', 'platform_profit', 'created_at')
    list_filter = ('status',)


