import time
import traceback
from django.core.management.base import BaseCommand
from bingo.models import GameRoom
from bingo.api import _tick_room


class Command(BaseCommand):
    help = "Draws numbers every 5 seconds in the background"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("🎲 Background draw loop started... (Press Ctrl+C to stop)"))

        try:
            while True:
                try:
                    # 👇 FIX: Use .all() instead of .filter(is_active=True)
                    # to bypass the Djongo boolean bug!
                    rooms = GameRoom.objects.all()

                    for room in rooms:
                        _tick_room(room)

                except Exception as e:
                    # If MongoDB disconnects or Djongo throws a random error,
                    # it will print here and keep the game running.
                    self.stdout.write(self.style.ERROR(f"\n❌ Error in tick loop: {e}"))
                    # Commenting out traceback to prevent huge terminal spam,
                    # but keeping the error message visible.
                    # traceback.print_exc()

                # Wait 2 seconds before checking again
                time.sleep(2)

        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\n🛑 Stopped."))
