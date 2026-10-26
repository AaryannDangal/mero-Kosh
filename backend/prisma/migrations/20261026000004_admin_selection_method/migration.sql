-- Enable groups where eligible members request the pot and an organizer chooses.
ALTER TYPE "SelectionMethod" ADD VALUE IF NOT EXISTS 'ADMIN_SELECTION';
