const path = require('node:path');

function uiQaSession(argv, appData) {
  if (!argv.includes('--ui-qa')) return null;
  function option(name) {
    const prefix = `--${name}=`;
    const value = argv.find((argument) => argument.startsWith(prefix));
    if (value) return value.slice(prefix.length);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  }
  const directory = option('user-data-dir');
  const daily = path.resolve(appData, 'NetworkToolbox');
  function within(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
  if (
    !directory ||
    !path.isAbsolute(directory) ||
    within(daily, path.resolve(directory)) ||
    within(path.resolve(directory), daily)
  )
    throw new Error(
      '界面验收需要独立的绝对 --user-data-dir，不能使用日常用户数据目录或其上级目录。',
    );
  const size = option('ui-qa-size') ?? '1180x780';
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match || Number(match[1]) < 920 || Number(match[2]) < 680)
    throw new Error('界面验收窗口尺寸应为至少 920x680 的逻辑像素。');
  const theme = option('ui-qa-theme') ?? 'dark';
  if (!['system', 'light', 'dark'].includes(theme)) throw new Error('界面验收主题不正确。');
  return {
    directory: path.resolve(directory),
    width: Number(match[1]),
    height: Number(match[2]),
    theme,
    hidden: argv.includes('--ui-qa-hidden'),
  };
}

module.exports = { uiQaSession };
