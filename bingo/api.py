import json
import traceback
from datetime import timedelta
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from django.db import transaction
from django.conf import settings

from .models import (
    TelegramUser, Cartela, GameRoom, GameRound,
    Transaction, DepositRequest, WithdrawalRequest,
    PlayerCartela
)
from .game_logic import draw_number, detect_line, line_numbers, find_winners, generate_cartelas
from .webapp_auth import webapp_auth_required

DRAW_INTERVAL_SECONDS = 5


def _json(data, status=200):
    return JsonResponse(data, status=status)


def _get_room():
    room = GameRoom.objects.first()
    if not room:
        room = GameRoom.objects.create(stake=Decimal('10.00'), name="Main Bingo Room", is_active=True)
    return room


# ═══ USER & PROFILE ═══
@webapp_auth_required
def me(request):
    u = request.tg_user
    return _json({
        'ok': True, 'user': {
            'id': u.telegram_id, 'first_name': u.first_name, 'username': u.username,
            'nickname': u.nickname or u.first_name, 'balance': str(u.balance),
            'total_earned': str(u.total_earned), 'total_invite': u.total_invite
        }
    })


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def update_nickname(request):
    body = json.loads(request.body or '{}')
    new_nick = body.get('nickname', '').strip()
    if not new_nick or len(new_nick) > 20:
        return _json({'ok': False, 'error': 'Nickname must be 1-20 characters.'}, 400)
    request.tg_user.nickname = new_nick
    request.tg_user.save()
    return _json({'ok': True, 'nickname': new_nick})


@webapp_auth_required
def dashboard_state(request):
    room = _get_room()
    round_obj = (
            GameRound.objects.filter(room=room, status='active').order_by('-id').first()
            or GameRound.objects.filter(room=room, status='waiting').order_by('-id').first()
    )
    prize_pool = round_obj.prize_pool if round_obj else 0.0

    admin_ids = [int(x) for x in getattr(settings, 'ADMIN_TELEGRAM_IDS', [])]
    is_admin = request.tg_user.telegram_id in admin_ids

    platform_balance = "0.0"
    if is_admin:
        all_rounds = GameRound.objects.all()
        total_profit = sum([r.platform_profit for r in all_rounds])
        platform_balance = str(total_profit) if total_profit else "0.0"

    return _json({
        'ok': True, 'balance': str(request.tg_user.balance),
        'prize_pool': str(prize_pool), 'status': round_obj.status if round_obj else 'idle',
        'is_admin': is_admin, 'platform_balance': platform_balance
    })


# ═══ CARTELAS & BUYING ═══
@webapp_auth_required
def list_cartelas(request):
    room = _get_room()

    cartela_count = Cartela.objects.count()
    if cartela_count > 200:
        ids_to_keep = list(Cartela.objects.order_by('cartela_number').values_list('id', flat=True)[:200])
        Cartela.objects.exclude(id__in=ids_to_keep).delete()
    elif cartela_count < 200:
        generate_cartelas(200)

    cartelas = list(Cartela.objects.order_by('cartela_number').values('id', 'cartela_number')[:200])

    round_obj = GameRound.objects.filter(room=room, status='waiting').order_by('-id').first()

    if not round_obj:
        last = GameRound.objects.order_by('-round_number').first()
        next_num = (last.round_number + 1) if last else 1
        round_obj = GameRound.objects.create(
            round_number=next_num, room_id=room.id, entry_fee=room.stake,
            status='waiting', start_at=None # ✅ Do not start timer until someone buys
        )

    # ✅ FIX: DO NOT force start_at here. Let toggle_cartela handle it.

    current_players = PlayerCartela.objects.filter(round=round_obj).select_related('cartela', 'user')
    sold_numbers = {p.cartela.cartela_number for p in current_players}

    cartelas_data = []
    for c in cartelas:
        is_sold = c['cartela_number'] in sold_numbers
        is_mine = any(
            p.user.telegram_id == request.tg_user.telegram_id and p.cartela.cartela_number == c['cartela_number']
            for p in current_players
        )
        cartelas_data.append({
            'id': c['id'],
            'number': c['cartela_number'],
            'sold': is_sold,
            'mine': is_mine
        })

    return _json({
        'ok': True, 'room': {'stake': str(room.stake)},
        'starts_at': round_obj.start_at.isoformat() if round_obj.start_at else None,
        'status': round_obj.status, # ✅ ADDED: Send status so JS knows when to redirect
        'cartelas': cartelas_data,
        'my_balance': str(request.tg_user.balance),
    })


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def toggle_cartela(request):
    try:
        body = json.loads(request.body or '{}')
        cartela_id = body.get('cartela_id')
        if not cartela_id:
            return _json({'ok': False, 'error': 'missing_cartela_id'}, 400)

        room = _get_room()
        user = request.tg_user
        stake_amount = Decimal(str(room.stake))

        with transaction.atomic():
            round_obj = GameRound.objects.select_for_update().filter(room=room, status='waiting').order_by('-id').first()
            if not round_obj:
                return _json({'ok': False, 'error': 'Purchasing is closed. Game starting.'}, 400)

            try:
                c = Cartela.objects.get(id=cartela_id)
            except Cartela.DoesNotExist:
                return _json({'ok': False, 'error': 'Cartela not found.'}, 404)

            existing = PlayerCartela.objects.filter(round=round_obj, user=user, cartela=c).first()

            if existing:
                existing.delete()
                c.is_sold = False
                c.save()

                user.balance += stake_amount
                user.save()
                Transaction.objects.create(user=user, amount=stake_amount, type='refund',
                                           note=f"Released Cartela #{c.cartela_number}")

                if hasattr(round_obj, 'recalculate_pool'):
                    try: round_obj.recalculate_pool()
                    except: pass

                return _json({'ok': True, 'action': 'released', 'balance': str(user.balance)})
            else:
                if PlayerCartela.objects.filter(round=round_obj, cartela=c).exists():
                    return _json({'ok': False, 'error': 'Cartela already bought by someone else.'}, 400)

                if user.balance < stake_amount:
                    return _json({'ok': False, 'error': 'Insufficient balance.'}, 400)

                c.is_sold = True
                c.save()

                PlayerCartela.objects.create(
                    round=round_obj, user=user, cartela=c, marked_numbers=[]
                )

                user.balance -= stake_amount
                user.save()
                Transaction.objects.create(user=user, amount=-stake_amount, type='buy_cartela',
                                           note=f"Bought Cartela #{c.cartela_number}")

                if hasattr(round_obj, 'recalculate_pool'):
                    try: round_obj.recalculate_pool()
                    except: pass

                # ✅ FIX: Start the 60s timer on the very first purchase
                if not round_obj.start_at:
                    round_obj.start_at = timezone.now() + timedelta(seconds=60)
                round_obj.save()

                return _json({'ok': True, 'action': 'purchased', 'balance': str(user.balance)})

    except Exception as e:
        traceback.print_exc()
        return _json({'ok': False, 'error': f"Python Crash: {str(e)}"}, 500)


@webapp_auth_required
def cartela_preview(request, cartela_id):
    try:
        c = Cartela.objects.get(id=cartela_id)
    except Cartela.DoesNotExist:
        return _json({'ok': False, 'error': 'not_found'}, 404)
    return _json({'ok': True, 'number': c.cartela_number, 'numbers': c.numbers})


# ═══ GAME PLAY ═══
@webapp_auth_required
def game_state(request):
    room = _get_room()

    waiting = GameRound.objects.filter(room=room, status='waiting').first()
    if waiting and waiting.start_at and timezone.now() >= waiting.start_at:
        unique_players = PlayerCartela.objects.filter(round=waiting).values('user').distinct().count()
        if unique_players >= 2:
            waiting.status = 'active'
            waiting.started_at = timezone.now()
            waiting.last_draw_at = timezone.now() - timedelta(seconds=DRAW_INTERVAL_SECONDS + 1)
            waiting.save()
        else:
            # ✅ RESET TIMER IF LESS THAN 2 PLAYERS
            waiting.start_at = timezone.now() + timedelta(seconds=60)
            waiting.save()

    active_round = GameRound.objects.filter(room=room, status='active').order_by('-id').first()

    if active_round:
        now = timezone.now()
        if not active_round.last_draw_at or (now - active_round.last_draw_at).total_seconds() >= DRAW_INTERVAL_SECONDS:
            draw_number(active_round)
            active_round.last_draw_at = now
            active_round.save(update_fields=['called_numbers', 'last_draw_at'])

            try:
                winners = find_winners(active_round)
                if winners or len(active_round.called_numbers or []) >= 75:
                    active_round.status = 'finished'
                    active_round.finished_at = timezone.now()
                    active_round.save()

                    if winners:
                        _settle_round(active_round, winners)
                    _schedule_next_round(room)
            except Exception as e:
                print(f"⚠️ Auto winner check error: {e}")

        round_obj = GameRound.objects.filter(id=active_round.id).first()
    else:
        recent_finished = GameRound.objects.filter(
            room=room, status='finished', finished_at__gte=timezone.now() - timedelta(seconds=60)
        ).order_by('-id').first()
        round_obj = recent_finished or GameRound.objects.filter(room=room, status='waiting').order_by('-id').first()

    my_cartelas, winners_info, players_list = [], [], []
    current_players = []
    unique_user_ids = set()

    if round_obj:
        current_players = PlayerCartela.objects.filter(round=round_obj).select_related('user', 'cartela')
        unique_user_ids = {p.user.telegram_id for p in current_players}

        users = TelegramUser.objects.filter(telegram_id__in=unique_user_ids)
        players_list = [(u.nickname or u.first_name) for u in users]

        called = set(round_obj.called_numbers or [])
        for p in current_players:
            if p.user.telegram_id == request.tg_user.telegram_id:
                marked = set(p.marked_numbers or [])

                try:
                    line = detect_line(p.cartela.numbers, marked & called)
                    line_nums = list(line_numbers(p.cartela.numbers, line)) if line else []
                except Exception as e:
                    print(f"⚠️ Line detection error in game_state: {e}")
                    line = False
                    line_nums = []

                my_cartelas.append({
                    'player_id': p.user.telegram_id,
                    'cartela_number': p.cartela.cartela_number,
                    'numbers': p.cartela.numbers,
                    'marked': list(marked),
                    'line': line,
                    'line_numbers': line_nums,
                })

        if round_obj.status == 'finished':
            wins = Transaction.objects.filter(type='win',
                                              note__contains=f"Round #{round_obj.round_number}").select_related('user')
            for w in wins:
                wp = next((p for p in current_players if p.user.telegram_id == w.user.telegram_id), None)
                if wp:
                    winners_info.append({
                        'name': w.user.nickname or w.user.first_name,
                        'amount': str(w.amount),
                        'cartela_number': wp.cartela.cartela_number,
                        'numbers': wp.cartela.numbers,
                        'marked_numbers': wp.marked_numbers,
                    })

    return _json({
        'ok': True,
        'round': {
            'number': round_obj.round_number if round_obj else None,
            'status': round_obj.status if round_obj else 'idle',
            'called_numbers': round_obj.called_numbers if round_obj else [],
            'players': len(unique_user_ids) if round_obj else 0,
            'players_list': players_list,
            'start_at': round_obj.start_at.isoformat() if round_obj and round_obj.start_at else None,
            'prize_pool': str(round_obj.prize_pool) if round_obj else '0.0',
        },
        'my_cartelas': my_cartelas,
        'winners': winners_info,
    })


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def toggle_mark(request, player_id):
    try:
        if int(player_id) != int(request.tg_user.telegram_id):
            return _json({'ok': False, 'error': 'player_id_mismatch'}, 403)
    except (TypeError, ValueError):
        return _json({'ok': False, 'error': 'invalid_player_id'}, 400)

    body = json.loads(request.body or '{}')
    number = body.get('number')

    room = _get_room()
    round_obj = GameRound.objects.filter(room=room, status__in=['active', 'waiting']).order_by('-id').first()
    if not round_obj:
        return _json({'ok': False, 'error': 'no_active_game'}, 400)

    called = set(round_obj.called_numbers or [])
    if number not in called:
        return _json({'ok': False, 'error': 'not_called_yet'}, 400)

    my_pcs = PlayerCartela.objects.filter(round=round_obj, user=request.tg_user)
    updated = False
    for pc in my_pcs:
        flat = [n for row in pc.cartela.numbers for n in row]
        if number not in flat:
            continue
        marked = set(pc.marked_numbers or [])
        if number in marked:
            continue
        marked.add(number)
        pc.marked_numbers = list(marked)

        try:
            line = detect_line(pc.cartela.numbers, marked)
            pc.line_numbers = list(line_numbers(pc.cartela.numbers, line)) if line else []
        except Exception as e:
            print(f"⚠️ Line detection error in toggle_mark: {e}")
            pc.line_numbers = []

        pc.save(update_fields=['marked_numbers', 'line_numbers'])
        updated = True

    if not updated:
        return _json({'ok': False, 'error': 'already_marked_or_not_found'}, 400)

    return _json({'ok': True})


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def claim_bingo(request):
    room = _get_room()
    with transaction.atomic():
        round_obj = GameRound.objects.select_for_update().filter(room=room, status='active').first()
        if not round_obj:
            return _json({'ok': False, 'error': 'No active game right now.'}, 400)

        my_pcs = PlayerCartela.objects.filter(round=round_obj, user=request.tg_user)
        if not my_pcs.exists():
            return _json({'ok': False, 'error': 'You are not in this round.'}, 400)

        called = set(round_obj.called_numbers or [])
        has_valid_bingo = False

        for pc in my_pcs:
            try:
                if detect_line(pc.cartela.numbers, set(pc.marked_numbers) & called):
                    has_valid_bingo = True
                    break
            except Exception as e:
                print(f"⚠️ Bingo validation error: {e}")

        if not has_valid_bingo:
            my_pcs.delete()
            return _json({
                'ok': False,
                'error': 'FALSE_BINGO',
                'message': 'You clicked BINGO without a valid line! You have been removed from the game.'
            }, 400)

        round_obj.status = 'finished'
        round_obj.finished_at = timezone.now()
        round_obj.save()

        try:
            winners = find_winners(round_obj)
            payouts = _settle_round(round_obj, winners) if winners else {}
        except Exception as e:
            print(f"❌ Payout error: {e}")
            payouts = {}

        _schedule_next_round(room)

    return _json({'ok': True, 'payouts': payouts})


# ═══ HISTORY, WALLET, FINANCE ═══
@webapp_auth_required
def scores(request):
    top_wins = Transaction.objects.filter(type='win').select_related('user').order_by('-amount')[:20]
    data = [{'name': w.user.nickname or w.user.first_name, 'amount': str(w.amount),
             'date': w.created_at.strftime('%Y-%m-%d')} for w in top_wins]
    return _json({'ok': True, 'scores': data})


@webapp_auth_required
def history(request):
    u = request.tg_user
    my_participations = PlayerCartela.objects.filter(user=u).select_related('round', 'cartela').order_by('-round__id')[:50]

    data = []
    for p in my_participations:
        r = p.round
        wins = Transaction.objects.filter(type='win', note__contains=f"Round #{r.round_number}").select_related('user')
        winners_list = [f"🏆 {w.user.nickname or w.user.first_name} (+{w.amount} birr)" for w in wins]

        data.append({
            'cartela_number': p.cartela.cartela_number,
            'round_number': r.round_number,
            'round_status': r.status,
            'prize_pool': str(r.prize_pool),
            'date': r.created_at.strftime('%Y-%m-%d %H:%M'),
            'winners': winners_list if winners_list else ['No winner yet']
        })
    return _json({'ok': True, 'history': data})


@webapp_auth_required
def wallet(request):
    u = request.tg_user
    tx = u.transactions.all()[:50]
    return _json({
        'ok': True, 'balance': str(u.balance),
        'transactions': [
            {'amount': str(t.amount), 'type': t.type, 'note': t.note, 'date': t.created_at.strftime('%Y-%m-%d %H:%M')}
            for t in tx],
    })


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def request_deposit(request):
    body = json.loads(request.body or '{}')
    try:
        amount = float(body.get('amount', '0'))
    except:
        return _json({'ok': False, 'error': 'Invalid amount.'}, 400)
    if amount < 100.0 or amount > 2000.0:
        return _json({'ok': False, 'error': 'Deposit must be between 100 and 2000 birr.'}, 400)
    DepositRequest.objects.create(user=request.tg_user, amount=amount)
    return _json({'ok': True, 'message': 'Deposit request sent. Admin will verify.'})


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def request_withdrawal(request):
    body = json.loads(request.body or '{}')
    phone = body.get('phone', '').strip()
    try:
        amount = float(body.get('amount', '0'))
    except:
        return _json({'ok': False, 'error': 'Invalid amount.'}, 400)
    if not phone or len(phone) < 10: return _json({'ok': False, 'error': 'Invalid phone number.'}, 400)
    if amount < 100.0 or amount > 4000.0:
        return _json({'ok': False, 'error': 'Withdrawal must be between 100 and 4000 birr.'}, 400)

    with transaction.atomic():
        locked_user = TelegramUser.objects.select_for_update().get(id=request.tg_user.id)
        if locked_user.balance < amount: return _json({'ok': False, 'error': 'Insufficient balance.'}, 400)

        locked_user.balance -= amount
        locked_user.save()

        WithdrawalRequest.objects.create(user=locked_user, amount=amount, phone_number=phone)
        Transaction.objects.create(user=locked_user, amount=-amount, type='withdraw', note=f"Withdrawal to {phone}")
    return _json({'ok': True, 'new_balance': str(locked_user.balance)})


@webapp_auth_required
def get_referrals(request):
    u = request.tg_user
    referrals = u.referrals.all().order_by('-created_at')
    ref_list = [{'name': r.nickname or r.first_name, 'date': r.created_at.strftime('%Y-%m-%d')} for r in referrals]
    link = f"https://t.me/jofishbingo_bot?start=ref_{u.telegram_id}"
    return _json({'ok': True, 'link': link, 'count': len(ref_list), 'list': ref_list})


# ═══ ADMIN APIs ═══
@webapp_auth_required
def admin_stats(request):
    admin_ids = [int(x) for x in getattr(settings, 'ADMIN_TELEGRAM_IDS', [])]
    if request.tg_user.telegram_id not in admin_ids:
        return _json({'ok': False, 'error': 'Unauthorized'}, 403)

    total_profit = sum([r.platform_profit for r in GameRound.objects.all()])
    total_users = TelegramUser.objects.count()
    pending_deps = DepositRequest.objects.filter(status='pending').count()
    pending_wits = WithdrawalRequest.objects.filter(status='pending').count()

    return _json({
        'ok': True,
        'stats': {
            'profit': str(total_profit),
            'users': total_users,
            'pending_deposits': pending_deps,
            'pending_withdrawals': pending_wits
        }
    })


@webapp_auth_required
def admin_requests(request):
    admin_ids = [int(x) for x in getattr(settings, 'ADMIN_TELEGRAM_IDS', [])]
    if request.tg_user.telegram_id not in admin_ids:
        return _json({'ok': False, 'error': 'Unauthorized'}, 403)

    deps = DepositRequest.objects.filter(status='pending').select_related('user')
    wits = WithdrawalRequest.objects.filter(status='pending').select_related('user')

    dep_list = [{'id': d.id, 'type': 'deposit', 'name': d.user.nickname or d.user.first_name, 'amount': str(d.amount),
                 'phone': d.user.phone_number, 'date': d.created_at.strftime('%m-%d %H:%M')} for d in deps]
    wit_list = [{'id': w.id, 'type': 'withdraw', 'name': w.user.nickname or w.user.first_name, 'amount': str(w.amount),
                 'phone': w.phone_number, 'date': w.created_at.strftime('%m-%d %H:%M')} for w in wits]

    return _json({'ok': True, 'requests': dep_list + wit_list})


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def admin_action(request):
    admin_ids = [int(x) for x in getattr(settings, 'ADMIN_TELEGRAM_IDS', [])]
    if request.tg_user.telegram_id not in admin_ids:
        return _json({'ok': False, 'error': 'Unauthorized'}, 403)

    body = json.loads(request.body or '{}')
    req_type = body.get('type')
    req_id = body.get('id')
    action = body.get('action')

    if not req_type or not req_id or not action:
        return _json({'ok': False, 'error': 'missing_fields'}, 400)

    with transaction.atomic():
        if req_type == 'deposit':
            dep = DepositRequest.objects.select_for_update().get(id=req_id)
            if dep.status == 'pending':
                if action == 'approve':
                    dep.status = 'approved'
                    dep.user.balance += dep.amount
                    dep.user.save()
                    Transaction.objects.create(user=dep.user, amount=dep.amount, type='deposit',
                                               note=f"Admin Approved Deposit")
                else:
                    dep.status = 'rejected'
                dep.save()
        elif req_type == 'withdraw':
            wit = WithdrawalRequest.objects.select_for_update().get(id=req_id)
            if wit.status == 'pending':
                if action == 'approve':
                    wit.status = 'approved'
                else:
                    wit.status = 'rejected'
                    wit.user.balance += wit.amount
                    wit.user.save()
                    Transaction.objects.create(user=wit.user, amount=wit.amount, type='refund',
                                               note="Admin Rejected Withdrawal Refund")
                wit.save()

    return _json({'ok': True, 'message': f'{req_type} {action}d successfully.'})


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def admin_force_start(request):
    admin_ids = [int(x) for x in getattr(settings, 'ADMIN_TELEGRAM_IDS', [])]
    if request.tg_user.telegram_id not in admin_ids:
        return _json({'ok': False, 'error': 'Unauthorized'}, 403)

    room = _get_room()
    waiting = GameRound.objects.filter(room=room, status='waiting').first()

    if waiting:
        waiting.status = 'active'
        waiting.started_at = timezone.now()
        waiting.last_draw_at = timezone.now() - timedelta(seconds=DRAW_INTERVAL_SECONDS + 1)
        waiting.save()
        return _json({'ok': True, 'message': 'Game force started!'})

    return _json({'ok': False, 'error': 'No waiting round found.'}, 400)


# ═══ BACKGROUND ENGINE ═══
def _tick_room(room):
    waiting = GameRound.objects.filter(room=room, status='waiting').first()
    if waiting and waiting.start_at and timezone.now() >= waiting.start_at:
        unique_players = PlayerCartela.objects.filter(round=waiting).values('user').distinct().count()

        if unique_players >= 2:
            waiting.status = 'active'
            waiting.started_at = timezone.now()
            waiting.last_draw_at = timezone.now() - timedelta(seconds=DRAW_INTERVAL_SECONDS + 1)
            waiting.save()
        else:
            waiting.start_at = timezone.now() + timedelta(seconds=60)
            waiting.save()

    active = GameRound.objects.filter(room=room, status='active').first()
    if active:
        now = timezone.now()
        if not active.last_draw_at or (now - active.last_draw_at).total_seconds() >= DRAW_INTERVAL_SECONDS:
            draw_number(active)
            active.last_draw_at = now
            active.save(update_fields=['called_numbers', 'last_draw_at'])

        winners = find_winners(active)
        if winners or len(active.called_numbers or []) >= 75:
            active.status = 'finished'
            active.finished_at = timezone.now()
            active.save()

            if winners:
                _settle_round(active, winners)
            _schedule_next_round(room)


def _settle_round(round_obj, winners):
    pool = round_obj.prize_pool
    pcs = []
    for w in winners:
        if isinstance(w, tuple) or isinstance(w, list):
            pcs.append(w[0])
        else:
            pcs.append(w)

    ordered = sorted(pcs, key=lambda pc: pc.cartela.cartela_number)
    payouts = {}

    if len(ordered) == 1:
        pc = ordered[0]
        user = pc.user
        user.balance += pool
        user.total_earned += pool
        user.save()
        payouts[user.telegram_id] = str(pool)
        Transaction.objects.create(user=user, amount=pool, type='win', note=f"Round #{round_obj.round_number} winner")

    elif len(ordered) >= 2:
        # 60% to first winner
        pc_first = ordered[0]
        user_first = pc_first.user
        share_first = pool * Decimal('0.60')

        user_first.balance += share_first
        user_first.total_earned += share_first
        user_first.save()
        payouts[user_first.telegram_id] = str(share_first)
        Transaction.objects.create(user=user_first, amount=share_first, type='win',
                                   note=f"Round #{round_obj.round_number} first winner (60%)")

        # Distribute the 40%
        remaining_winners = ordered[1:]
        rest_pool = pool * Decimal('0.40')
        rest_share = rest_pool / len(remaining_winners)

        for pc in remaining_winners:
            user = pc.user
            user.balance += rest_share
            user.total_earned += rest_share
            user.save()
            payouts[user.telegram_id] = str(rest_share)
            Transaction.objects.create(user=user, amount=rest_share, type='win',
                                       note=f"Round #{round_obj.round_number} split winner (40%)")

    return payouts


def _schedule_next_round(room):
    if GameRound.objects.filter(room=room, status='waiting').exists():
        return

    Cartela.objects.all().update(is_sold=False)  # Reset cards
    last = GameRound.objects.order_by('-round_number').first()
    next_num = (last.round_number + 1) if last else 1

    # ✅ FIXED: Included all required fields for creating a new round
    GameRound.objects.create(
        room=room,
        round_number=next_num,
        entry_fee=room.stake,
        status='waiting',
        start_at=None # ✅ Timer will start when the first player buys a card
    )


@csrf_exempt
@webapp_auth_required
@require_http_methods(["POST"])
def redeem_coupon(request):
    return _json({'ok': False, 'error': 'Coupon system is currently disabled.'}, 400)
