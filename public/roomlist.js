var ROOMS = [];
var ERROR_COUNT = 0;
var DIFF_NAMES = { FUNNY: '标准', NORMAL: '险境', HARD: '绝境', ABYSS: '终极' };

var listEl = document.getElementById('list');
var countEl = document.getElementById('roomcount');
var quickBtn = document.getElementById('quickBtn');
var errBar = document.getElementById('errbar');

function poll() {
  fetch('/x/plugin-roomlist/rooms')
    .then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    })
    .then(function (d) {
      ERROR_COUNT = 0;
      errBar.style.display = 'none';
      if (d && Array.isArray(d.rooms)) {
        ROOMS = d.rooms;
        render();
      }
    })
    .catch(function () {
      ERROR_COUNT++;
      if (ERROR_COUNT >= 3) errBar.style.display = 'block';
      if (ROOMS.length === 0) {
        listEl.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>暂无房间数据</div>';
      }
    });
}

function joinRoom(code) {
  if (code) location.href = '/?room=' + encodeURIComponent(code);
}

function render() {
  var html = '';
  if (ROOMS.length === 0) {
    html = '<div class="empty"><div class="empty-icon">&#128123;</div>暂无公开房间<br><span style="font-size:12px;color:#5d6863">如果房主开启了公开，这里就会显示</span></div>';
  } else {
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      var cls = r.inMatch ? ' card--match' : '';
      var difTag = r.inMatch ? '' : ('<span class="tag tag--' + (r.difficulty || 'NORMAL') + '">' + (DIFF_NAMES[r.difficulty] || r.difficulty || '险境') + '</span>');
      var modeTag = '<span class="tag tag--mode">' + (r.mode === 'solo' ? '独立' : '同盟') + '</span>';
      var statCls = r.inMatch ? 'badge--match' : 'badge--wait';
      var statText = r.inMatch ? '战斗中' : '等待中';
      var btnClass = r.inMatch ? 'btn-join btn-join--watch' : 'btn-join';
      var btnText = r.inMatch ? '观战' : '加入';
      html += '<div class="card' + cls + '" data-roomcode="' + r.code + '">' +
        '<div class="card-left"><span class="card-code">' + r.code + '</span><span class="card-host">房主：' + r.host + '</span></div>' +
        '<div class="card-mid">' + difTag + modeTag + '</div>' +
        '<div class="card-right"><span class="players">' + r.humans + '/' + r.maxSeats + '</span><span class="badge ' + statCls + '">' + statText + '</span>' +
        '<button class="' + btnClass + '">' + btnText + '</button></div>' +
        '</div>';
    }
  }
  countEl.textContent = ROOMS.length + ' 个房间';
  var avail = ROOMS.filter(function (r) { return !r.inMatch; });
  quickBtn.disabled = !avail.length;
  listEl.innerHTML = html;
}

listEl.addEventListener('click', function (e) {
  var target = e.target;
  while (target && target !== listEl) {
    if (target.tagName === 'BUTTON' || target.classList.contains('card')) {
      break;
    }
    target = target.parentNode;
  }
  if (!target || target === listEl) return;
  if (target.tagName === 'BUTTON') {
    e.stopPropagation();
    var card = target.closest('.card');
    target = card;
  }
  if (target && target.dataset.roomcode) {
    joinRoom(target.dataset.roomcode);
  }
});

quickBtn.onclick = function () {
  var avail = ROOMS.filter(function (r) { return !r.inMatch; });
  if (avail.length) {
    var r = avail[Math.floor(Math.random() * avail.length)];
    location.href = '/?room=' + encodeURIComponent(r.code);
  }
};

poll();
setInterval(poll, 5000);