import os
import django
import pymongo
from bson.decimal128 import Decimal128  # 👈 Required to read MongoDB decimals
from decimal import Decimal

# 1. Setup Django to access old data
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bingo_project.settings')
django.setup()

from bingo.models import (
    TelegramUser, GameRound, GameRoom, Cartela,
     Transaction, DepositRequest, WithdrawalRequest
)

# 2. Connect to MongoDB
mongo_client = pymongo.MongoClient(os.getenv('MONGO_DB_HOST', 'mongodb://localhost:27017'))
db = mongo_client[os.getenv('MONGO_DB_NAME', 'bingo_db')]


# 👇 HELPER FUNCTION: Safely converts Decimal128, Decimal, or String to Float
def to_float(val):
    if val is None:
        return 0.0
    if isinstance(val, Decimal128):
        return float(val.to_decimal())
    if isinstance(val, Decimal):
        return float(val)
    try:
        return float(val)
    except:
        return 0.0


def migrate():
    print("Starting migration...")

    # --- Migrate Users ---
    print("Migrating Users...")
    for user in TelegramUser.objects.all():
        db.telegramuser.insert_one({
            "telegram_id": user.telegram_id,
            "username": user.username or "",
            "first_name": user.first_name or "",
            "nickname": user.nickname or "",
            "phone_number": user.phone_number or "",
            "balance": to_float(user.balance),  # 👈 Using helper function
            "total_earned": to_float(user.total_earned),
            "total_invite": user.total_invite,
            "created_at": user.created_at
        })

    # --- Migrate Transactions ---
    print("Migrating Transactions...")
    for t in Transaction.objects.all():
        db.transaction.insert_one({
            "user_id": t.user.telegram_id,
            "amount": to_float(t.amount),
            "type": t.type,
            "note": t.note or "",
            "created_at": t.created_at
        })

    # --- Migrate Deposit Requests ---
    print("Migrating Deposits...")
    for d in DepositRequest.objects.all():
        db.depositrequest.insert_one({
            "user_id": d.user.telegram_id,
            "amount": to_float(d.amount),
            "reference_number": d.reference_number or "",
            "status": d.status,
            "created_at": d.created_at
        })

    # --- Migrate Withdrawal Requests ---
    print("Migrating Withdrawals...")
    for w in WithdrawalRequest.objects.all():
        db.withdrawalrequest.insert_one({
            "user_id": w.user.telegram_id,
            "amount": to_float(w.amount),
            "name": w.name or "",
            "phone_number": w.phone_number,
            "status": w.status,
            "created_at": w.created_at
        })

    # --- Migrate GameRounds with Embedded Players ---
    print("Migrating GameRounds with embedded players...")
    for game_round in GameRound.objects.all():
        # Find players for this round
        players_queryset = PlayerCartela.objects.filter(round_id=game_round.id)

        embedded_players = []
        for p in players_queryset:
            embedded_players.append({
                "player_id": p.user.telegram_id,
                "cartela_number": p.cartela.cartela_number,
                "numbers": p.cartela.numbers,
                "marked_numbers": p.marked_numbers or [],
                "line_numbers": []
            })

        db.gameround.insert_one({
            "round_number": game_round.round_number,
            "status": game_round.status,
            "called_numbers": game_round.called_numbers or [],
            "entry_fee": to_float(game_round.entry_fee),  # 👈 Using helper function
            "prize_pool": to_float(game_round.prize_pool),
            "platform_profit": to_float(game_round.platform_profit),
            "start_at": game_round.start_at,
            "started_at": game_round.started_at,
            "finished_at": game_round.finished_at,
            "created_at": game_round.created_at,
            "players": embedded_players
        })

    print("✅ Migration complete successfully!")


if __name__ == "__main__":
    migrate()
