/** IPC channel names (renderer -> main). Kept free of imports: the sandboxed preload bundles this file. */
export const IPC_CHANNEL_NAMES = [
  'tools:detect',
  'folder:pick',
  'task:analyse',
  'run:start',
  'run:cancel',
  'run:handoffResult',
  'run:confirm',
  'run:retryStep',
  'accounts:status',
  'accounts:connect',
  'accounts:disconnect',
  'web:show',
  'web:hide',
  'web:insertBrief',
  'web:focus',
  'web:captureSelection',
  'web:markSignedIn',
  'web:openInBrowser',
  'history:list',
  'history:rate',
  'history:clear',
  'history:export',
  'folder:open',
  'folder:list',
  'settings:get',
  'settings:set',
  'link:open',
  'bridge:status',
  'bridge:enable',
  'bridge:newCode',
  'bridge:revoke'
] as const

/**
 * The only channels a browser socket may call (exact list). Everything else is refused: `web:*`, `link:open`, `folder:pick`,
 * `folder:open`, `accounts:connect`, `accounts:disconnect`, `history:clear`, `bridge:*`. `settings:set` is allowed with the
 * `{ lang }` patch only (checked in the bridge).
 */
export const WEB_ALLOWED_CHANNELS = [
  'tools:detect',
  'accounts:status',
  'task:analyse',
  'run:start',
  'run:cancel',
  'run:confirm',
  'run:retryStep',
  'run:handoffResult',
  'history:list',
  'history:rate',
  'settings:get',
  'settings:set',
  'folder:list',
  'history:export'
] as const
