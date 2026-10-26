'use strict'
'require baseclass'

var colors = {
  trace: '#64748b',
  debug: '#7c3aed',
  info: '#0369a1',
  warning: '#b45309',
  error: '#dc2626',
  fatal: '#be123c',
  panic: '#be123c',
  plain: 'inherit',
}
return baseclass.extend({
  parse: function (text) {
    var previous = 'plain'
    return (text.match(/[^\n]*\n|[^\n]+$/g) || []).map(function (line) {
      var header =
        line.match(/^time=(?:"[^"]*"|\S+)\s+level=(\w+)\b/i) ||
        line.match(/^\[(trace|debug|info|warn|warning|error|fatal|panic)\]/i)
      var value = header && header[1].toLowerCase()
      if (line.charAt(0) === '{') {
        try {
          value = JSON.parse(line).level.toLowerCase()
        } catch (_) {
          value = 'plain'
        }
      }
      if (value)
        previous = value === 'warn' ? 'warning' : Object.prototype.hasOwnProperty.call(colors, value) ? value : 'plain'
      return { text: line, level: previous }
    })
  },
  render: function (text) {
    return this.parse(text).map(function (entry) {
      return E(
        'span',
        {
          'data-log-level': entry.level,
          style: 'color:var(--nailink-log-' + entry.level + ',' + colors[entry.level] + ')',
        },
        entry.text,
      )
    })
  },
  // 按级别和关键字挑行。dae 每几秒重选一次 dialer，健康的 info 行会把真正的
  // 警告冲走，所以这两个筛选是日常最需要的东西。
  filter: function (text, options) {
    var needle = ((options && options.search) || '').trim().toLowerCase()
    var wanted = (options && options.levels) || []
    return this.parse(text).filter(function (entry) {
      var level = entry.level === 'plain' ? 'info' : entry.level
      if (wanted.length && wanted.indexOf(level) === -1) return false
      if (needle && entry.text.toLowerCase().indexOf(needle) === -1) return false
      return true
    })
  },
  legend: function (onToggle, active) {
    var levels = [
      ['debug', 'DEBUG 调试'],
      ['info', 'INFO 信息'],
      ['warning', 'WARN 警告'],
      ['error', 'ERROR 错误'],
    ]
    var selected = active || []
    return E(
      'p',
      { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px', 'aria-label': '日志级别颜色说明' },
      levels.map(function (item) {
        var level = item[0]
        var on = selected.indexOf(level) !== -1
        var style =
          'color:var(--nailink-log-' + level + ',' + colors[level] + ');' +
          'background:none;border:0;padding:0;font:inherit;cursor:pointer;' +
          (on ? 'text-decoration:underline;font-weight:600' : 'opacity:.55')
        var props = { 'data-log-level-toggle': level, 'aria-pressed': on ? 'true' : 'false', style: style }
        if (typeof onToggle === 'function') props.click = function () { onToggle(level) }
        return E(typeof onToggle === 'function' ? 'button' : 'span', props, item[1])
      }),
    )
  },
  theme: function (node) {
    if (!node || typeof window.getComputedStyle !== 'function') return
    var current = node,
      rgb = null
    while (current) {
      var background = window.getComputedStyle(current).backgroundColor
      if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
        rgb = background.match(/[\d.]+/g)
        break
      }
      current = current.parentElement
    }
    var dark = rgb && rgb.length >= 3 ? (Number(rgb[0]) + Number(rgb[1]) + Number(rgb[2])) / 3 < 128 : false
    var palette = dark
      ? {
          trace: '#94a3b8',
          debug: '#c4b5fd',
          info: '#7dd3fc',
          warning: '#fcd34d',
          error: '#fca5a5',
          fatal: '#fda4af',
          panic: '#fda4af',
          plain: 'inherit',
        }
      : colors
    Object.keys(palette).forEach(function (level) {
      node.style.setProperty('--nailink-log-' + level, palette[level])
    })
  },
})
