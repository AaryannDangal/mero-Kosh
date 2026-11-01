# Unlimited Rounds & Multiple Pots — Summary

## What was built
1. **Unlimited Rounds**
   - `closeRound` now auto-creates Round N+1 if no upcoming round exists.
   - New rounds are generated from the current schedule based on the group's frequency (WEEKLY/BIWEEKLY/MONTHLY).
   - The `RoundsPage` now shows only the Active round + 2 most recent completed rounds, with a collapsible "History" section to avoid mobile clutter.

2. **Multiple Pot Obligations**
   - New `PotObligation` Prisma model tracks each pot award individually: `originalAmount`, `remainingPrincipal`, `interestRateBp`, `isCleared`.
   - Removed the `@@unique([groupId, winnerMemberId])` constraint from `Round` so members can win multiple times.
   - `overrideWinner` and `recordPayout` now create a `PotObligation` record each time a pot is awarded.
   - `state.ts` now aggregates all obligations per member, charges interest on every active pot, and applies repayments to the oldest pot first. The `potObligation` result now shows total remaining principal and summed monthly interest.

3. **UI & History**
   - `RoundsPage.tsx` cleanly separates Active / Recent / Collapsible History.
   - Frontend types expanded to include per-pot breakdown in `PotObligation.pots[]`.

4. **Migration**
   - `20261029000001_add_pot_obligations_allow_multi_win/migration.sql` drops the winner unique constraint and creates the `pot_obligations` table.

## Files touched
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/...`
- `backend/src/services/rounds.ts`
- `backend/src/services/state.ts`
- `backend/src/domain/calculations.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/pages/RoundsPage.tsx`

## How to test
1. Close an existing round — check that Round N+1 appears automatically open next.
2. Assign pot to Aaryan again — he should be eligible, and a new `PotObligation` record should appear.
3. Check Member Balance: if Aaryan has two active pots, monthly interest should be sum of both, and total principal should decrease as he pays.
4. Open Rounds page on mobile — active round + 2 recent are visible; older rounds hidden under "View History".

## Next steps
- Backfill existing pot awards into `PotObligation` (migration does not create records for old payouts — will require a one-time backfill script if needed).
- Optionally add a `Add Next Round` manual button for admins who want to schedule ahead.
