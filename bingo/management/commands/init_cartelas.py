from django.core.management.base import BaseCommand
from bingo.game_logic import generate_cartelas

class Command(BaseCommand):
    help = "Generate all 200 cartelas"

    def handle(self, *args, **options):
        n = generate_cartelas(200)
        self.stdout.write(self.style.SUCCESS(f"{n} cartelas created."))