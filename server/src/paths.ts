import os from 'node:os';
import path from 'node:path';

/** Where bots keep their files on this computer: ~/.openkrishbot/library/<botId> (the Library tab) and browser profiles. */
const root = path.join(os.homedir(), '.openkrishbot');

export const libraryRoot = () => path.join(root, 'library');
export const profilesRoot = () => path.join(root, 'profiles');
