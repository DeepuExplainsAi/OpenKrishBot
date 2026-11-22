/** Worker files are forked: .ts through tsx when run from source, plain .js after the build. */
export const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
export const tsxArgs = ext === '.ts' ? ['--import', import.meta.resolve('tsx')] : [];
