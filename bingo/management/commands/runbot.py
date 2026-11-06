from django.core.management.base import BaseCommand
from bingo.views import get_application

class Command(BaseCommand):
    help = "Run Telegram bot with long polling (local dev only)"

    def handle(self, *args, **options):
        app = get_application()
        self.stdout.write("🤖 Bot polling started... Press Ctrl+C to stop.")
        app.run_polling()