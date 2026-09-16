import type { DraftPick, LeagueFormat, UUID } from './types';

export interface IdempotentCommand {
  idempotencyKey: string;
}

export interface CommittedState<T> {
  data: T;
  stateVersion: number;
}

export interface CreateLeagueCommand extends IdempotentCommand {
  name: string;
  competitionId: UUID;
  format: LeagueFormat;
}

export interface DraftPickCommand extends IdempotentCommand {
  draftId: UUID;
  athleteId: UUID;
}

export interface LineupEntryCommand {
  athleteId: UUID;
  slotCode: string;
}

export interface SetLineupCommand extends IdempotentCommand {
  fantasyTeamId: UUID;
  gameId: UUID;
  entries: readonly LineupEntryCommand[];
}

export interface AddDropCommand extends IdempotentCommand {
  fantasyTeamId: UUID;
  athleteInId: UUID;
  athleteOutId: UUID | null;
}

export interface TradeProposalCommand extends IdempotentCommand {
  proposingTeamId: UUID;
  receivingTeamId: UUID;
  offeredAthleteIds: readonly UUID[];
  requestedAthleteIds: readonly UUID[];
  expiresAt: string;
}

export interface TrustedFantasyCommands {
  createLeague(command: CreateLeagueCommand): Promise<CommittedState<{ leagueId: UUID }>>;
  makeDraftPick(command: DraftPickCommand): Promise<CommittedState<DraftPick>>;
  setLineup(command: SetLineupCommand): Promise<CommittedState<{ entryCount: number }>>;
  addFreeAgent(command: AddDropCommand): Promise<CommittedState<{ transactionId: UUID }>>;
  requestWaiver(command: AddDropCommand): Promise<CommittedState<{ claimId: UUID }>>;
  proposeTrade(command: TradeProposalCommand): Promise<CommittedState<{ tradeId: UUID }>>;
}
