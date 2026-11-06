import random
from .models import Cartela


def generate_cartelas(count=200):
    existing = set(Cartela.objects.values_list('cartela_number', flat=True))
    created = 0
    for i in range(1, count + 1):
        if i not in existing:
            Cartela.objects.create(
                cartela_number=i,
                numbers=Cartela.generate_numbers()
            )
            created += 1
    return created


def draw_number(round_obj):
    if not round_obj.called_numbers:
        round_obj.called_numbers = []

    already = set(round_obj.called_numbers)
    available = [n for n in range(1, 76) if n not in already]
    if not available:
        return None
    num = random.choice(available)

    round_obj.called_numbers.append(num)
    round_obj.save()
    return num


def detect_line(grid, marked):
    marked = set(marked)
    marked.add(grid[2][2])
    for r in range(5):
        if all(grid[r][c] in marked for c in range(5)): return {'type': 'row', 'index': r}
    for c in range(5):
        if all(grid[r][c] in marked for r in range(5)): return {'type': 'col', 'index': c}
    if all(grid[i][i] in marked for i in range(5)): return {'type': 'diag', 'which': 'main'}
    if all(grid[i][4 - i] in marked for i in range(5)): return {'type': 'diag', 'which': 'anti'}
    return None


def line_numbers(grid, line):
    if not line: return set()
    t = line['type']
    if t == 'row': return set(grid[line['index']])
    if t == 'col': return {grid[r][line['index']] for r in range(5)}
    if t == 'diag': return {grid[i][i] for i in range(5)} if line['which'] == 'main' else {grid[i][4 - i] for i in
                                                                                           range(5)}
    return set()


def find_winners(round_obj):
    winners = []
    called = set(round_obj.called_numbers or [])
    players = round_obj.players if isinstance(round_obj.players, list) else []

    for p in players:
        # 👇 FIX: Treat player as a dictionary instead of a Django model
        marked = set(p.get('marked_numbers', []))
        valid_marks = marked & called
        line = detect_line(p['numbers'], valid_marks)
        if line:
            winners.append((p, line))
    return winners