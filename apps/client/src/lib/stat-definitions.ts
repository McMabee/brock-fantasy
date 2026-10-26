const meanings: Readonly<Record<string, string>> = {
  goals: 'Goals credited to the athlete in the official game record',
  assists: 'Assists credited to the athlete on a scoring play in the official game record',
  power_play_goals: 'Hockey goals scored while the athlete’s team has a player advantage',
  short_handed_goals: 'Hockey goals scored while the athlete’s team has fewer players on the ice',
  penalty_minutes: 'Minutes of penalties charged to the athlete',
  multi_point: 'The additional scoring bonus for a qualifying multi-point hockey game',
  wins: 'Official wins credited to the goalie',
  goals_allowed: 'Opponent goals charged to the goalie',
  saves: 'Shots stopped by the goalie',
  shutouts: 'Games with no goals allowed by the only goalie used, allowing brief empty-net time',
  points: 'Basketball points scored from field goals and free throws',
  offensive_rebounds: 'Rebounds collected after a missed shot by the athlete’s own team',
  defensive_rebounds: 'Rebounds collected after an opponent’s missed shot',
  blocks: 'Opponent shot attempts blocked by the athlete',
  steals: 'Possession gained by taking the ball from an opponent',
  turnovers: 'Possessions lost by the athlete',
  fouls: 'Personal fouls charged to the athlete',
  foul_out: 'The additional scoring penalty when an athlete fouls out',
  double_double: 'The bonus for reaching double figures in two qualifying basketball statistics',
  kills: 'Volleyball attacks that directly win a point',
  aces: 'Serves that directly win a point',
  solo_blocks: 'Successful blocks credited to one blocker',
  assisted_blocks: 'Successful blocks shared with another blocker',
  digs: 'Successful defensive receptions of an opponent’s attack',
  errors: 'The combined attack, service, reception, setting, ball-handling and blocking errors',
  attack_errors: 'Attacks that lose a point, such as hitting out or into the net',
  service_errors: 'Serves that lose a point',
  reception_errors: 'Serve-reception errors charged to the athlete',
  setting_errors: 'Setting errors charged to the athlete',
  ball_handling_errors: 'Illegal ball contacts charged to the athlete',
  blocking_errors: 'Blocking violations charged to the athlete',
  hitter_bonus: 'The position-specific bonus for a qualifying hitter performance',
  setter_bonus: 'The position-specific bonus for a qualifying setter performance',
  libero_bonus: 'The position-specific bonus for a qualifying libero performance',
};
export function statDefinition(key: string): string {
  return (
    meanings[key.split('.').at(-1) ?? key] ??
    'The official credited game statistic used by the league scoring rules'
  );
}
