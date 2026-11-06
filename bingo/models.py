# bingo/models.py
from django.db import models
from djongo import models as djongo_models
from django.utils import timezone
import random
import string


# --- Embedded Models for GameRound ---
class PlayerCartelaEmbedded(djongo_models.Model):
    player_id = models.BigIntegerField()  # Telegram User ID
    cartela_number = models.IntegerField()
    numbers = models.JSONField()  # The 5x5 grid
    marked_numbers = models.JSONField(default=list)
    line_numbers = models.JSONField(default=list, null=True, blank=True)

    class Meta:
        abstract = True


# --- Main Models ---
class TelegramUser(models.Model):
    telegram_id = models.BigIntegerField(unique=True, db_index=True)
    username = models.CharField(max_length=255, blank=True, null=True)
    first_name = models.CharField(max_length=255, blank=True)
    nickname = models.CharField(max_length=50, blank=True, null=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    # 👇 CHANGED TO FloatField
    balance = models.FloatField(default=0.0)
    total_earned = models.FloatField(default=0.0)
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

    # 👇 ADD THIS MISSING METHOD
    @staticmethod
    def generate_numbers():
        import random
        col_ranges = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75)]
        cols = [random.sample(range(lo, hi + 1), 5) for lo, hi in col_ranges]
        return [[cols[c][r] for c in range(5)] for r in range(5)]


class GameRoom(models.Model):
    # 👇 REMOVED max_digits (FloatField does not support it)
    stake = models.FloatField(unique=True)
    name = models.CharField(max_length=50)
    is_active = models.BooleanField(default=True)


class GameRound(models.Model):
    STATUS_CHOICES = [('waiting', 'Waiting'), ('active', 'Active'), ('finished', 'Finished')]
    round_number = models.IntegerField(unique=True)
    room = models.ForeignKey(GameRoom, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='waiting')
    called_numbers = models.JSONField(default=list)
    # 👇 REMOVED max_digits
    entry_fee = models.FloatField(default=10.0)
    prize_pool = models.FloatField(default=0.0)
    platform_profit = models.FloatField(default=0.0)

    # 👇 EMBEDDED PLAYERS: This is the MongoDB way!
    players = models.JSONField(default=list)

    start_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    last_draw_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def recalculate_pool(self):
        # In MongoDB, you must calculate player count from the embedded array
        player_count = len(self.players)
        total = self.entry_fee * player_count
        self.prize_pool = total * 0.8
        self.platform_profit = total * 0.2
        self.save()

    def __str__(self):
        return f"Round #{self.round_number} [{self.status}]"


class Transaction(models.Model):
    TYPE_CHOICES = [('coupon', 'Coupon'), ('buy_cartela', 'Buy'), ('win', 'Win'), ('deposit', 'Deposit'),
                    ('withdraw', 'Withdraw')]
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='transactions')
    # 👇 CHANGED TO FloatField
    amount = models.FloatField()
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class DepositRequest(models.Model):
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='deposits')
    # 👇 CHANGED TO FloatField
    amount = models.FloatField()
    reference_number = models.CharField(max_length=50, blank=True, null=True,unique=True)
    status = models.CharField(max_length=10, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)


class WithdrawalRequest(models.Model):
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='withdrawals')
    # 👇 CHANGED TO FloatField
    amount = models.FloatField()
    name = models.CharField(max_length=100, blank=True, null=True)
    phone_number = models.CharField(max_length=20)
    status = models.CharField(max_length=10, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)