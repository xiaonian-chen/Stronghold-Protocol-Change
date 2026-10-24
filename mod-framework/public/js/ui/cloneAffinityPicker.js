// cloneAffinityPicker.js — In-game affinity bond selector for clone mode.
// Shows a compact dropdown under the ready button (right side of TopBar).
// Each bond entry has its icon; bonds disabled by the mode are shown with
// strikethrough text, unselectable, and sorted to the bottom.
// Only shown when the room is in clone mode (room.gameMode === 'clone').

import { useState, useMemo, useCallback, useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { useGameData } from './gameComponents.js';
import { act } from './gameActions.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { bondIconUrl } from './assetUrls.js';

function BondImage({ src, fallback }) {
  var badState = useState(null);
  var badSrc = badState[0];
  var setBad = badState[1];
  if (!src || badSrc === src) {
    return fallback ? html`<span class="ca-pick__glyph">${fallback}</span>` : null;
  }
  return html`<img class="ca-pick__img" src=${src} alt="" draggable=${false} onError=${function () { setBad(src); }} />`;
}

export function CloneAffinityPicker() {
  var pub = useStore(function (s) { return s.match.public; });
  var priv = useStore(function (s) { return s.match.private; });
  var room = useStore(function (s) { return s.room; });
  var gd = useGameData();

  var bandId = priv ? priv.bandId : null;
  var currentBondId = priv ? priv.affinityBondId : null;

  var assets = data.get('assets');

  var bondOptions = useMemo(function () {
    if (!bandId || !gd.ready) return [];
    var allBonds = gd.list('bonds');
    if (!allBonds || !allBonds.length) return [];

    // disabledBonds from the server: [...bans.drawn, ...bans.staticOff] — the static-off
    // bonds are the mode's inactiveBondIds (e.g. 卡西米尔 in 标准模拟), already computed
    // on the server (pool.js drawDisabledBonds → views.js publicView).
    var disabledArr = Array.isArray(pub && pub.disabledBonds) ? pub.disabledBonds : [];
    var offBonds = new Set(disabledArr.filter(function (b) { return typeof b === 'string'; }));

    var list = allBonds.map(function (b) {
      return { id: b.bondId, name: b.name || b.bondId, disabled: offBonds.has(b.bondId), isCore: !!b.isCore };
    });
    list.sort(function (a, b) {
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return list;
  }, [bandId, gd.ready, pub, data.locale()]);

  var busyState = useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];

  var openState = useState(false);
  var open = openState[0];
  var setOpen = openState[1];

  var pickerRef = useRef(null);

  useEffect(function () {
    if (!open) return;
    function handleClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return function () { document.removeEventListener('mousedown', handleClick); };
  }, [open]);

  var selectBond = useCallback(function (bondId) {
    if (!bondId || busy) return;
    setBusy(true);
    act('g.setAffinityBond', { bondId: bondId }).finally(function () {
      setBusy(false);
      setOpen(false);
    });
  }, [busy]);

  if (!bandId || !bondOptions.length) return null;
  if (!room || room.gameMode !== 'clone') return null;

  var isRandom = currentBondId === '__random';
  var currentBond = currentBondId && !isRandom ? gd.bond(currentBondId) : null;
  var currentName = isRandom ? t('随机') : currentBond ? (currentBond.name || currentBondId) : t('选择倾向盟约');
  var currentIcon = isRandom ? null : bondIconUrl(assets, currentBondId);

  return html`<div class="ca-pick" ref=${pickerRef} title=${t('倾向盟约：影响商店倾向格的刷新')}>
    <span class="ca-pick__label">${t('倾向盟约')}</span>
    <button type="button" class="ca-pick__btn tapx" onClick=${function () { setOpen(!open); }} disabled=${busy} aria-expanded=${open ? 'true' : 'false'}>
      <span class="ca-pick__btn-icon">
        ${isRandom ? html`<span class="ca-pick__glyph">?</span>` : html`<${BondImage} src=${currentIcon} fallback=${currentBondId ? [...(currentName || '?')][0] : null} />`}
      </span>
      <span class="ca-pick__btn-name">${currentName}</span>
      <${Icon} name="chevronDown" class="ca-pick__chev" />
    </button>
    ${open ? html`<div class="ca-pick__drop">
      <button type="button" key="__random"
        class=${'ca-pick__opt' + (currentBondId === '__random' ? ' is-active' : '')}
        onClick=${function () { selectBond('__random'); }}>
        <span class="ca-pick__opt-icon"><span class="ca-pick__glyph">?</span></span>
        <span class="ca-pick__opt-name">${t('随机')}</span>
      </button>
      ${bondOptions.map(function (b) {
        var iconUrl = bondIconUrl(assets, b.id);
        return html`<button type="button" key=${b.id}
          class=${'ca-pick__opt' + (b.disabled ? ' is-disabled' : '')}
          disabled=${b.disabled}
          onClick=${function () { if (!b.disabled) selectBond(b.id); }}>
          <span class="ca-pick__opt-icon">
            <${BondImage} src=${iconUrl} fallback=${[...b.name][0]} />
          </span>
          <span class="ca-pick__opt-name">${b.name}</span>
        </button>`;
      })}
    </div>` : null}
    ${busy ? html`<${Icon} name="loading" class="ca-pick__busy" />` : null}
  </div>`;
}