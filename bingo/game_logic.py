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


def detect_line(cartela_numbers, marked_numbers):
    """
    Checks for valid Bingo lines: Horizontal, Vertical, Diagonal, or 4 Corners.
    The center cell is automatically considered marked.
    """
    # Ensure the center cell (index 12) is ALWAYS marked
    center_number = cartela_numbers[2][2]
    if center_number not in marked_numbers:
        marked_numbers.add(center_number)

    # 1. Check Rows
    for row in cartela_numbers:
        if all(num in marked_numbers for num in row):
            return True

    # 2. Check Columns
    for col in range(5):
        if all(cartela_numbers[row][col] in marked_numbers for row in range(5)):
            return True

    # 3. Check Diagonals
    diag1 = [cartela_numbers[i][i] for i in range(5)]
    diag2 = [cartela_numbers[i][4-i] for i in range(5)]
    if all(num in marked_numbers for num in diag1) or all(num in marked_numbers for num in diag2):
        return True

    # 4. Check 4 Corners
    corners = [
        cartela_numbers[0][0], cartela_numbers[0][4],
        cartela_numbers[4][0], cartela_numbers[4][4]
    ]
    if all(num in marked_numbers for num in corners):
        return True

    return False


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