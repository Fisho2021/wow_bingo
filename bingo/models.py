# bingo/models.py
from django.db import models
from django.utils import timezone
import random
from decimal import Decimal


# --- Main Models ---
class TelegramUser(models.Model):
    telegram_id = models.BigIntegerField(unique=True, db_index=True)
    username = models.CharField(max_length=255, blank=True, null=True)
    first_name = models.CharField(max_length=255, blank=True)
    nickname = models.CharField(max_length=50, blank=True, null=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True)

    # 🔧 FIXED: Use DecimalField for money
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total_earned = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total_invite = models.IntegerField(default=0)

    referred_by = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='referrals')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.nickname or self.first_name} - {self.balance} birr"


class Cartela(models.Model):
    cartela_number = models.IntegerField(unique=True, db_index=True)
    numbers = models.JSONField()
    is_sold = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    @staticmethod
    def generate_numbers():
        col_ranges = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75)]
        cols = [random.sample(range(lo, hi + 1), 5) for lo, hi in col_ranges]
        return [[cols[c][r] for c in range(5)] for r in range(5)]


class GameRoom(models.Model):
    # 🔧 FIXED: Use DecimalField
    stake = models.DecimalField(max_digits=10, decimal_places=2, unique=True)
    name = models.CharField(max_length=50)
    is_active = models.BooleanField(default=True)


class GameRound(models.Model):
    STATUS_CHOICES = [('waiting', 'Waiting'), ('active', 'Active'), ('finished', 'Finished')]
    round_number = models.IntegerField(unique=True)
    room = models.ForeignKey(GameRoom, null=True, blank=True, on_delete=models.SET_NULL, related_name='rounds')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='waiting')
    called_numbers = models.JSONField(default=list, blank=True)

    # 🔧 FIXED: Use DecimalField
    entry_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('10.00'))
    prize_pool = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    platform_profit = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))

    start_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    last_draw_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def recalculate_pool(self):
        # self.players now refers to the related PlayerCartela model
        player_count = self.players.count()
        total = self.entry_fee * Decimal(player_count)
        self.prize_pool = (total * Decimal('0.8')).quantize(Decimal('0.01'))
        self.platform_profit = (total * Decimal('0.2')).quantize(Decimal('0.01'))
        self.save(update_fields=['prize_pool', 'platform_profit'])

    def __str__(self):
        return f"Round #{self.round_number} [{self.status}]"


class PlayerCartela(models.Model):
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='my_cartelas')
    cartela = models.ForeignKey(Cartela, on_delete=models.CASCADE)
    round = models.ForeignKey(GameRound, on_delete=models.CASCADE, related_name='players')
    marked_numbers = models.JSONField(default=list, blank=True)
    line_numbers = models.JSONField(default=list, null=True, blank=True)
    purchased_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'cartela', 'round')

    def __str__(self):
        return f"{self.user} → Cartela #{self.cartela.cartela_number}"


class Transaction(models.Model):
    TYPE_CHOICES = [('coupon', 'Coupon'), ('buy_cartela', 'Buy'), ('win', 'Win'), ('deposit', 'Deposit'),
                    ('withdraw', 'Withdraw'), ('refund', 'Refund')]
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='transactions')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class DepositRequest(models.Model):
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='deposits')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reference_number = models.CharField(max_length=50, blank=True, null=True, unique=True)
    status = models.CharField(max_length=10, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)


class WithdrawalRequest(models.Model):
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='withdrawals')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    name = models.CharField(max_length=100, blank=True, null=True)
    phone_number = models.CharField(max_length=20)
    status = models.CharField(max_length=10, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)