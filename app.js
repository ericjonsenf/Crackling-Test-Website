// Papan Marketing Crackling — data, grafik, jadwal kerja.
// Data ada di Supabase. Siapa boleh melihat apa ditentukan oleh Row Level Security
// di supabase-schema.sql; penyembunyian menu di sini hanya supaya tampilannya rapi,
// bukan pengaman. Pengamannya ada di database.
(function () {
  'use strict';

  var cfg = window.SUPABASE_CONFIG || {};
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  // Siapa boleh melihat apa. Harus cermin dari policy di supabase-schema.sql.
  var PERMS = {
    owner: { money: true, ads: true, social: true, allWork: true },
    lead: { money: true, ads: true, social: true, allWork: true },
    ads: { money: false, ads: true, social: false, allWork: false },
    social: { money: false, ads: false, social: true, allWork: false }
  };
  var ROLE_LABEL = { owner: 'Owner', lead: 'Marketing Lead', ads: 'Crew Ads', social: 'Crew Social Media' };
  // Supabase mewajibkan format email. Tim cukup mengetik username; domain ini
  // ditempelkan otomatis dan tidak pernah dikirimi email apa pun.
  var LOGIN_DOMAIN = '@crackling.id';
  function toEmail(v) {
    v = String(v).trim().toLowerCase();
    return v.indexOf('@') === -1 ? v + LOGIN_DOMAIN : v;
  }
  var me = null;   // { id, name, role }
  var perm = PERMS.social;

  var BRANCHES = [
    { key: 'gading_serpong', label: 'Gading Serpong', color: '#c1440e' },
    { key: 'kelapa_gading', label: 'Kelapa Gading', color: '#d99208' }
  ];
  var SOURCES = [
    { key: 'esb', label: 'ESB', color: '#c1440e' },
    { key: 'gojek_grab', label: 'Gojek / Grab', color: '#d99208' },
    { key: 'paper', label: 'Paper', color: '#4f7a36' }
  ];
  var PLATFORMS = [
    { key: 'instagram', label: 'Instagram', bg: 'linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)', line: '#d9418a' },
    { key: 'tiktok', label: 'TikTok', bg: '#241708', line: '#241708' },
    { key: 'threads', label: 'Threads', bg: '#4f7a36', line: '#4f7a36' }
  ];
  // Channel iklan. Field metriknya mengikuti kolom Meta Ads Manager supaya bisa disalin apa adanya.
  var CHANNELS = [
    { key: 'meta', label: 'Meta Ads', color: '#c1440e' },
    { key: 'tiktok', label: 'TikTok Ads', color: '#241708' },
    { key: 'kol', label: 'KOL / Influencer', color: '#4f7a36' }
  ];
  var AD_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'results', 'result_value'];
  var PAGES = ['ringkasan', 'penjualan', 'iklan', 'sosial', 'jadwal'];
  var DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  // ---------- tanggal (waktu lokal, bukan UTC) ----------
  function dateStr(d) { return (d || new Date()).toLocaleDateString('en-CA'); }
  function shiftDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }
  function lastNDates(n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(shiftDays(-i));
    return out;
  }
  function monthKey() { return dateStr().slice(0, 7); }
  function shortLabel(ds) {
    var d = new Date(ds + 'T00:00:00');
    return d.getDate() + '/' + (d.getMonth() + 1);
  }
  function dayInitial(ds) {
    return new Date(ds + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' });
  }
  function longDate(ds) {
    return new Date(ds + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function monthName(y, m) {
    return new Date(y, m, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  }
  function daysLeftInMonth() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  }
  function rupiah(n) { return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
  function rupiahShort(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return 'Rp' + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace('.', ',') + 'jt';
    if (n >= 1000) return 'Rp' + Math.round(n / 1000) + 'rb';
    return 'Rp' + n;
  }
  function pct(a, b) { return b ? Math.round(((a - b) / b) * 100) : null; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function emptySale() { return { esb: 0, gojek_grab: 0, paper: 0 }; }
  function emptyAd() {
    var o = {};
    AD_FIELDS.forEach(function (f) { o[f] = 0; });
    return o;
  }
  // Turunan metrik — rumusnya sama persis dengan yang dipakai Meta Ads Manager.
  function derive(a) {
    return {
      spend: a.spend, impressions: a.impressions, reach: a.reach,
      clicks: a.clicks, results: a.results, result_value: a.result_value,
      ctr: a.impressions ? (a.clicks / a.impressions) * 100 : 0,
      cpc: a.clicks ? a.spend / a.clicks : 0,
      cpm: a.impressions ? (a.spend / a.impressions) * 1000 : 0,
      cpa: a.results ? a.spend / a.results : 0,
      roas: a.spend ? a.result_value / a.spend : 0,
      freq: a.reach ? a.impressions / a.reach : 0
    };
  }
  function addAd(target, src) {
    AD_FIELDS.forEach(function (f) { target[f] += Number(src[f]) || 0; });
    return target;
  }

  // ---------- autentikasi & profil ----------
  var Auth = {
    async session() {
      var res = await sb.auth.getSession();
      return res.data.session;
    },
    async signIn(email, password) {
      return await sb.auth.signInWithPassword({ email: email, password: password });
    },
    async signOut() { await sb.auth.signOut(); },
    // Ambil profil + peran. Kalau barisnya belum ada, akunnya belum diberi peran.
    async profile(userId) {
      var res = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
      return res.data;
    }
  };

  // ---------- akses data ----------
  // Semua query di bawah tunduk pada Row Level Security. Kalau peran pengguna
  // tidak berhak, Supabase mengembalikan kosong / error — bukan datanya.
  var DB = {
    async getSales(dates) {
      var map = {};
      dates.forEach(function (d) {
        map[d] = {};
        BRANCHES.forEach(function (b) { map[d][b.key] = emptySale(); });
      });
      var res = await sb.from('sales_daily').select('*')
        .gte('entry_date', dates[0]).lte('entry_date', dates[dates.length - 1]);
      (res.data || []).forEach(function (r) {
        if (!map[r.entry_date] || !map[r.entry_date][r.branch]) return;
        map[r.entry_date][r.branch] = {
          esb: Number(r.esb) || 0, gojek_grab: Number(r.gojek_grab) || 0, paper: Number(r.paper) || 0
        };
      });
      return map;
    },
    async saveSales(date, branch, vals) {
      return await sb.from('sales_daily')
        .upsert(Object.assign({ entry_date: date, branch: branch }, vals), { onConflict: 'entry_date,branch' });
    },

    // -> { '2026-09-16': { meta:{spend,impressions,...}, tiktok:{...}, kol:{...} } }
    async getAds(dates) {
      var map = {};
      dates.forEach(function (d) {
        map[d] = {};
        CHANNELS.forEach(function (c) { map[d][c.key] = emptyAd(); });
      });
      var res = await sb.from('ad_daily').select('*')
        .gte('entry_date', dates[0]).lte('entry_date', dates[dates.length - 1]);
      (res.data || []).forEach(function (r) {
        if (!map[r.entry_date] || !map[r.entry_date][r.channel]) return;
        var o = emptyAd();
        AD_FIELDS.forEach(function (f) { o[f] = Number(r[f]) || 0; });
        map[r.entry_date][r.channel] = o;
      });
      return map;
    },
    async saveAd(date, channel, vals) {
      return await sb.from('ad_daily')
        .upsert(Object.assign({ entry_date: date, channel: channel }, vals), { onConflict: 'entry_date,channel' });
    },

    async getNotes(dates) {
      var map = {};
      dates.forEach(function (d) { map[d] = ''; });
      var res = await sb.from('campaign_notes').select('*')
        .gte('entry_date', dates[0]).lte('entry_date', dates[dates.length - 1]);
      (res.data || []).forEach(function (r) { map[r.entry_date] = r.note || ''; });
      return map;
    },
    async saveNote(date, note) {
      return await sb.from('campaign_notes').upsert({ entry_date: date, note: note }, { onConflict: 'entry_date' });
    },

    async getBudget(mk) {
      var res = await sb.from('monthly_budget').select('*').eq('month', mk).maybeSingle();
      return res.data ? Number(res.data.ad_budget) || 0 : 0;
    },
    async saveBudget(mk, amount) {
      return await sb.from('monthly_budget').upsert({ month: mk, ad_budget: amount }, { onConflict: 'month' });
    },
    // total biaya iklan satu bulan kalender, semua channel
    async getMonthSpend(mk) {
      var res = await sb.from('ad_daily').select('spend')
        .gte('entry_date', mk + '-01').lte('entry_date', mk + '-31');
      return (res.data || []).reduce(function (s, r) { return s + (Number(r.spend) || 0); }, 0);
    },

    async getSocialHistory(limit) {
      var res = await sb.from('social_daily').select('*').order('entry_date', { ascending: false }).limit(limit);
      return (res.data || []).reverse();
    },
    async saveSocial(date, vals) {
      return await sb.from('social_daily').upsert(Object.assign({ entry_date: date }, vals), { onConflict: 'entry_date' });
    },

    // --- jadwal kerja ---
    // RLS sudah membatasi ke milik sendiri kecuali owner/lead, jadi tidak perlu
    // filter user_id di sini.
    async getWork() {
      var res = await sb.from('work_items').select('*').order('work_date');
      return res.data || [];
    },
    async addWork(item) {
      return await sb.from('work_items').insert(Object.assign({ user_id: me.id }, item));
    },
    async setWorkDone(id, done) {
      return await sb.from('work_items').update({ done: done }).eq('id', id);
    },
    async deleteWork(id) {
      return await sb.from('work_items').delete().eq('id', id);
    }
  };

  // ---------- helper hitung ----------
  var range = 7;
  var recapText = '';

  function branchTotal(s) { return s.esb + s.gojek_grab + s.paper; }
  function dayTotal(m) { return BRANCHES.reduce(function (a, b) { return a + branchTotal(m[b.key]); }, 0); }
  function sumRange(dates, sales) { return dates.reduce(function (a, d) { return a + dayTotal(sales[d]); }, 0); }

  // ---------- grafik ----------
  // total biaya iklan satu hari, semua channel
  function daySpend(adDay) {
    return CHANNELS.reduce(function (a, c) { return a + adDay[c.key].spend; }, 0);
  }

  function comboChart(dates, sales, ads, notes) {
    var W = 780, H = 230, padL = 54, padR = 54, padT = 16, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = dates.length, slot = iw / n;
    var barW = Math.min(30, Math.max(4, slot * 0.62));
    var totals = dates.map(function (d) { return dayTotal(sales[d]); });
    var spends = dates.map(function (d) { return daySpend(ads[d]); });
    var maxSales = Math.max.apply(null, totals.concat([1]));
    var maxSpend = Math.max.apply(null, spends.concat([1]));
    var ySpend = function (v) { return padT + ih - (v / maxSpend) * ih; };
    var cx = function (i) { return padL + slot * i + slot / 2; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik penjualan harian dan biaya iklan">';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + ih - f * ih;
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#ece3d6" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + rupiahShort(maxSales * f) + '</text>' +
        '<text x="' + (W - padR + 8) + '" y="' + (y + 4) + '" text-anchor="start" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + rupiahShort(maxSpend * f) + '</text>';
    });
    dates.forEach(function (d, i) {
      var total = totals[i];
      if (!total) return;
      var x = cx(i) - barW / 2, yc = padT + ih;
      BRANCHES.forEach(function (b) {
        var v = branchTotal(sales[d][b.key]);
        if (!v) return;
        var h = (v / maxSales) * ih;
        yc -= h;
        svg += '<rect x="' + x + '" y="' + yc + '" width="' + barW + '" height="' + h + '" fill="' + b.color + '">' +
          '<title>' + shortLabel(d) + ' · ' + b.label + ': ' + rupiah(v) + '</title></rect>';
      });
    });
    svg += '<polyline points="' + dates.map(function (d, i) { return cx(i) + ',' + ySpend(spends[i]); }).join(' ') +
      '" fill="none" stroke="#241708" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>';
    var every = n > 14 ? Math.ceil(n / 8) : 1;
    dates.forEach(function (d, i) {
      if (spends[i]) {
        svg += '<circle cx="' + cx(i) + '" cy="' + ySpend(spends[i]) + '" r="3" fill="#241708">' +
          '<title>' + shortLabel(d) + ' · iklan: ' + rupiah(spends[i]) + '</title></circle>';
      }
      if (notes[d]) {
        svg += '<circle cx="' + cx(i) + '" cy="' + (padT - 6) + '" r="3.5" fill="#c1440e"><title>' + esc(notes[d]) + '</title></circle>';
      }
      if (i % every === 0 || i === n - 1) {
        svg += '<text x="' + cx(i) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + shortLabel(d) + '</text>';
      }
    });
    return svg + '</svg>';
  }

  // biaya iklan per hari, batang bertumpuk per channel
  function spendChart(dates, ads, notes) {
    var W = 780, H = 170, padL = 54, padR = 14, padT = 16, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = dates.length, slot = iw / n;
    var barW = Math.min(28, Math.max(4, slot * 0.62));
    var totals = dates.map(function (d) { return daySpend(ads[d]); });
    var max = Math.max.apply(null, totals.concat([1]));
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik biaya iklan per hari dipecah per channel">';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + ih - f * ih;
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#ece3d6" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + rupiahShort(max * f) + '</text>';
    });
    var every = n > 14 ? Math.ceil(n / 8) : 1;
    dates.forEach(function (d, i) {
      var x = padL + slot * i + slot / 2 - barW / 2;
      var yc = padT + ih;
      CHANNELS.forEach(function (c) {
        var v = ads[d][c.key].spend;
        if (!v) return;
        var h = Math.max(1, (v / max) * ih);
        yc -= h;
        svg += '<rect x="' + x + '" y="' + yc + '" width="' + barW + '" height="' + h + '" fill="' + c.color + '">' +
          '<title>' + shortLabel(d) + ' · ' + c.label + ': ' + rupiah(v) + '</title></rect>';
      });
      if (notes[d]) {
        svg += '<circle cx="' + (x + barW / 2) + '" cy="' + (padT - 7) + '" r="3" fill="#c1440e"><title>' + esc(notes[d]) + '</title></circle>';
      }
      if (i % every === 0 || i === n - 1) {
        svg += '<text x="' + (x + barW / 2) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + shortLabel(d) + '</text>';
      }
    });
    return svg + '</svg>';
  }

  // efisiensi: batang CPC (skala kiri, rupiah) + garis CTR (skala kanan, persen)
  function effChart(dates, ads) {
    var W = 780, H = 170, padL = 54, padR = 46, padT = 16, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = dates.length, slot = iw / n;
    var barW = Math.min(26, Math.max(4, slot * 0.58));
    var day = dates.map(function (d) {
      return derive(CHANNELS.reduce(function (acc, c) { return addAd(acc, ads[d][c.key]); }, emptyAd()));
    });
    var maxCpc = Math.max.apply(null, day.map(function (x) { return x.cpc; }).concat([1]));
    var maxCtr = Math.max.apply(null, day.map(function (x) { return x.ctr; }).concat([1]));
    var cx = function (i) { return padL + slot * i + slot / 2; };
    var yCtr = function (v) { return padT + ih - (v / maxCtr) * ih; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik biaya per klik dan rasio klik per hari">';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + ih - f * ih;
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#ece3d6" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + rupiahShort(maxCpc * f) + '</text>' +
        '<text x="' + (W - padR + 8) + '" y="' + (y + 4) + '" text-anchor="start" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + (maxCtr * f).toFixed(1).replace('.', ',') + '%</text>';
    });
    var every = n > 14 ? Math.ceil(n / 8) : 1;
    dates.forEach(function (d, i) {
      var m = day[i], x = cx(i) - barW / 2;
      if (m.cpc) {
        var h = Math.max(2, (m.cpc / maxCpc) * ih);
        svg += '<rect x="' + x + '" y="' + (padT + ih - h) + '" width="' + barW + '" height="' + h + '" rx="3" fill="#d99208">' +
          '<title>' + shortLabel(d) + ' · CPC ' + rupiah(m.cpc) + ' · ' + m.clicks.toLocaleString('id-ID') + ' klik</title></rect>';
      }
      if (i % every === 0 || i === n - 1) {
        svg += '<text x="' + cx(i) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10" fill="#a89880" font-family="JetBrains Mono, monospace">' + shortLabel(d) + '</text>';
      }
    });
    svg += '<polyline points="' + dates.map(function (d, i) { return cx(i) + ',' + yCtr(day[i].ctr); }).join(' ') +
      '" fill="none" stroke="#c1440e" stroke-width="2" stroke-linejoin="round"/>';
    dates.forEach(function (d, i) {
      if (!day[i].ctr) return;
      svg += '<circle cx="' + cx(i) + '" cy="' + yCtr(day[i].ctr) + '" r="3" fill="#c1440e">' +
        '<title>' + shortLabel(d) + ' · CTR ' + day[i].ctr.toFixed(2).replace('.', ',') + '%</title></circle>';
    });
    return svg + '</svg>';
  }

  function donutChart(segments) {
    var total = segments.reduce(function (a, s) { return a + s.value; }, 0);
    var size = 168, r = 62, sw = 26, c = size / 2, circ = 2 * Math.PI * r, offset = 0;
    var svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" style="width:168px;height:168px" role="img" aria-label="Komposisi sumber penjualan">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#f2ebe0" stroke-width="' + sw + '"/>';
    segments.forEach(function (s) {
      if (!total || !s.value) return;
      var len = (s.value / total) * circ;
      svg += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="' + sw +
        '" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + (-offset) +
        '" transform="rotate(-90 ' + c + ' ' + c + ')"><title>' + s.label + ': ' + rupiah(s.value) + '</title></circle>';
      offset += len;
    });
    return svg + '<text x="' + c + '" y="' + (c - 3) + '" text-anchor="middle" font-size="17" font-weight="700" fill="#241708" font-family="JetBrains Mono, monospace">' + rupiahShort(total) + '</text>' +
      '<text x="' + c + '" y="' + (c + 15) + '" text-anchor="middle" font-size="10" fill="#a89880">' + range + ' hari</text></svg>';
  }

  function sparkline(values, color) {
    if (values.length < 2) return '<svg viewBox="0 0 100 38" aria-hidden="true"></svg>';
    var W = 100, H = 38, pad = 4;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = max - min || 1;
    var pts = values.map(function (v, i) {
      return (pad + (i / (values.length - 1)) * (W - pad * 2)).toFixed(1) + ',' +
        (H - pad - ((v - min) / span) * (H - pad * 2)).toFixed(1);
    });
    var last = pts[pts.length - 1].split(',');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2" fill="' + color + '"/></svg>';
  }

  // ---------- render angka (penjualan / iklan / ringkasan) ----------
  async function renderNumbers() {
    var dates = lastNDates(range * 2);
    var cur = dates.slice(range), prev = dates.slice(0, range);
    var sales = await DB.getSales(dates);
    var ads = await DB.getAds(dates);
    var notes = await DB.getNotes(dates);

    renderSales(cur, sales, ads, notes);
    await renderAds(cur, prev, sales, ads, notes);
    await renderRecap(cur, prev, sales, ads, notes);
    await fillSalesForm();
  }

  function renderSales(cur, sales, ads, notes) {
    var today = cur[cur.length - 1], yest = cur[cur.length - 2];
    var todayTotal = dayTotal(sales[today]);
    var yestTotal = yest ? dayTotal(sales[yest]) : 0;

    document.getElementById('sales-today').textContent = rupiah(todayTotal);
    var el = document.getElementById('sales-delta');
    var p = pct(todayTotal, yestTotal);
    if (!todayTotal && !yestTotal) {
      el.className = 'delta flat';
      el.textContent = 'Belum ada data hari ini — isi lewat form di bawah.';
    } else if (p === null) {
      el.className = 'delta flat';
      el.textContent = 'Belum ada pembanding kemarin.';
    } else {
      el.className = 'delta ' + (p >= 0 ? 'up' : 'down');
      el.textContent = (p >= 0 ? '↑ +' : '↓ ') + p + '% dibanding kemarin (' + rupiah(yestTotal) + ')';
    }

    document.getElementById('branch-tiles').innerHTML = BRANCHES.map(function (b) {
      var v = branchTotal(sales[today][b.key]);
      var periodV = cur.reduce(function (s, d) { return s + branchTotal(sales[d][b.key]); }, 0);
      return '<div class="tile"><div class="label"><span class="swatch" style="background:' + b.color + '"></span>' + b.label + '</div>' +
        '<div class="value num">' + rupiah(v) + '</div>' +
        '<div class="hint">' + rupiahShort(periodV) + ' dalam ' + range + ' hari</div></div>';
    }).join('');

    document.getElementById('source-tiles').innerHTML = SOURCES.map(function (s) {
      var v = BRANCHES.reduce(function (a, b) { return a + sales[today][b.key][s.key]; }, 0);
      return '<div class="tile"><div class="label">' + s.label + '</div><div class="value num">' + rupiah(v) + '</div></div>';
    }).join('');

    document.getElementById('sales-chart').innerHTML = comboChart(cur, sales, ads, notes);
    document.getElementById('chart-legend').innerHTML =
      BRANCHES.map(function (b) {
        return '<span><span class="swatch" style="background:' + b.color + '"></span>' + b.label + '</span>';
      }).join('') +
      '<span><span class="dash"></span>biaya iklan (skala kanan)</span>' +
      '<span><span class="swatch" style="background:var(--ember);border-radius:50%"></span>hari ada promo</span>';

    var segs = SOURCES.map(function (s) {
      return {
        label: s.label, color: s.color,
        value: cur.reduce(function (sum, d) {
          return sum + BRANCHES.reduce(function (a, b) { return a + sales[d][b.key][s.key]; }, 0);
        }, 0)
      };
    });
    var segTotal = segs.reduce(function (a, s) { return a + s.value; }, 0);
    document.getElementById('donut-sub').textContent = 'Total ' + range + ' hari terakhir: ' + rupiah(segTotal);
    document.getElementById('source-donut').innerHTML = donutChart(segs);
    document.getElementById('source-legend').innerHTML = segs.map(function (s) {
      return '<div class="r"><span class="swatch" style="background:' + s.color + '"></span>' +
        '<span class="nm">' + s.label + '</span><span class="vl num">' + rupiah(s.value) + '</span>' +
        '<span class="pc num">' + (segTotal ? Math.round((s.value / segTotal) * 100) : 0) + '%</span></div>';
    }).join('');
  }

  async function renderAds(cur, prev, sales, ads, notes) {
    var revenue = sumRange(cur, sales);

    // agregat per channel + total, lalu turunkan CPC/CPM/CTR/CPA/ROAS
    var byChannel = {};
    CHANNELS.forEach(function (c) { byChannel[c.key] = emptyAd(); });
    var totalAd = emptyAd();
    cur.forEach(function (d) {
      CHANNELS.forEach(function (c) {
        addAd(byChannel[c.key], ads[d][c.key]);
        addAd(totalAd, ads[d][c.key]);
      });
    });
    var m = derive(totalAd);
    var spend = m.spend;
    var spendPrev = prev.reduce(function (a, d) { return a + daySpend(ads[d]); }, 0);
    var blendedRoas = spend ? revenue / spend : 0;
    var ratio = revenue ? (spend / revenue) * 100 : 0;

    var mk = monthKey();
    var budget = await DB.getBudget(mk);
    var monthSpend = await DB.getMonthSpend(mk);
    var usedPct = budget ? Math.round((monthSpend / budget) * 100) : 0;
    var now = new Date();

    document.getElementById('budget-month-label').textContent = 'Bulan ' + monthName(now.getFullYear(), now.getMonth());
    document.getElementById('budget-used').textContent = budget
      ? rupiah(monthSpend) + ' dari ' + rupiah(budget) : rupiah(monthSpend) + ' terpakai';
    var prog = document.getElementById('budget-progress');
    prog.className = 'progress' + (usedPct > 100 ? ' over' : '');
    prog.firstElementChild.style.width = Math.min(100, usedPct) + '%';

    var left = budget - monthSpend, dleft = daysLeftInMonth();
    document.getElementById('budget-hint').textContent = !budget
      ? 'Belum ada budget bulanan diisi — isi di bawah supaya pemakaiannya kelihatan.'
      : (usedPct > 100
        ? 'Lewat budget ' + rupiah(-left) + ' (' + usedPct + '%)'
        : usedPct + '% terpakai · sisa ' + rupiah(left) + ' untuk ' + dleft + ' hari lagi (≈' + rupiah(dleft ? left / dleft : left) + '/hari)');
    document.getElementById('b-amount').value = budget || '';

    // --- total biaya iklan ---
    var periodLabel = 'Periode ' + range + ' hari terakhir · ' + shortLabel(cur[0]) + ' – ' + shortLabel(cur[cur.length - 1]);
    document.getElementById('spend-period').textContent = periodLabel;
    document.getElementById('spend-total').textContent = rupiah(spend);
    var sd = document.getElementById('spend-delta');
    var sp = pct(spend, spendPrev);
    if (!spend && !spendPrev) {
      sd.className = 'delta flat';
      sd.textContent = 'Belum ada biaya iklan tercatat — isi lewat form di bawah.';
    } else if (sp === null) {
      sd.className = 'delta flat';
      sd.textContent = '≈' + rupiah(Math.round(spend / range)) + ' per hari';
    } else {
      sd.className = 'delta ' + (sp <= 0 ? 'up' : 'down');
      sd.textContent = (sp >= 0 ? '↑ +' : '↓ ') + sp + '% vs periode lalu (' + rupiah(spendPrev) + ') · ≈' + rupiah(Math.round(spend / range)) + '/hari';
    }

    document.getElementById('channel-tiles').innerHTML = CHANNELS.map(function (c) {
      var cm = derive(byChannel[c.key]);
      var share = spend ? Math.round((cm.spend / spend) * 100) : 0;
      return '<div class="tile"><div class="label"><span class="swatch" style="background:' + c.color + '"></span>' + c.label + '</div>' +
        '<div class="value num">' + rupiah(cm.spend) + '</div>' +
        '<div class="hint">' + (spend ? share + '% dari total' : 'belum ada data') +
        (cm.results ? ' · ' + cm.results.toLocaleString('id-ID') + ' hasil' : '') + '</div></div>';
    }).join('');

    document.getElementById('spend-chart').innerHTML = spendChart(cur, ads, notes);
    document.getElementById('spend-legend').innerHTML =
      CHANNELS.map(function (c) {
        return '<span><span class="swatch" style="background:' + c.color + '"></span>' + c.label + '</span>';
      }).join('') +
      '<span><span class="swatch" style="background:var(--ember);border-radius:50%"></span>hari ada promo</span>';

    // --- metrik performa (rumus Meta Ads) ---
    document.getElementById('perf-sub').textContent = periodLabel;
    var num = function (n) { return (Number(n) || 0).toLocaleString('id-ID'); };
    var dec = function (n, d) { return (Number(n) || 0).toFixed(d === undefined ? 2 : d).replace('.', ','); };
    document.getElementById('perf-tiles').innerHTML =
      '<div class="tile"><div class="label">Impresi</div><div class="value num">' + num(m.impressions) + '</div><div class="hint">berapa kali iklan tampil</div></div>' +
      '<div class="tile"><div class="label">Jangkauan</div><div class="value num">' + num(m.reach) + '</div><div class="hint">orang unik yang melihat</div></div>' +
      '<div class="tile"><div class="label">Frekuensi</div><div class="value num">' + (m.freq ? dec(m.freq, 1) + '×' : '—') + '</div><div class="hint">tayangan per orang</div></div>' +
      '<div class="tile"><div class="label">Klik</div><div class="value num">' + num(m.clicks) + '</div><div class="hint">link clicks</div></div>' +
      '<div class="tile"><div class="label">CTR</div><div class="value num">' + (m.ctr ? dec(m.ctr) + '%' : '—') + '</div><div class="hint">klik ÷ impresi</div></div>' +
      '<div class="tile accent"><div class="label">CPC</div><div class="value num">' + (m.cpc ? rupiah(m.cpc) : '—') + '</div><div class="hint">biaya ÷ klik</div></div>' +
      '<div class="tile"><div class="label">CPM</div><div class="value num">' + (m.cpm ? rupiah(m.cpm) : '—') + '</div><div class="hint">biaya per 1.000 impresi</div></div>' +
      '<div class="tile"><div class="label">Hasil</div><div class="value num">' + num(m.results) + '</div><div class="hint">konversi dari iklan</div></div>' +
      '<div class="tile accent"><div class="label">Biaya per hasil</div><div class="value num">' + (m.cpa ? rupiah(m.cpa) : '—') + '</div><div class="hint">biaya ÷ hasil</div></div>' +
      '<div class="tile"><div class="label">ROAS platform</div><div class="value num">' + (m.roas ? dec(m.roas, 1) + '×' : '—') + '</div><div class="hint">nilai hasil ÷ biaya</div></div>' +
      // blended & rasio butuh angka penjualan — hanya untuk peran yang boleh melihatnya
      (perm.money
        ? '<div class="tile"><div class="label">ROAS blended</div><div class="value num">' + (spend ? dec(blendedRoas, 1) + '×' : '—') + '</div><div class="hint">semua penjualan ÷ biaya</div></div>' +
          '<div class="tile"><div class="label">Rasio iklan</div><div class="value num">' + (revenue ? dec(ratio, 1) + '%' : '—') + '</div><div class="hint">porsi iklan dari penjualan</div></div>'
        : '');

    document.getElementById('roas-line').innerHTML = !spend
      ? 'Belum ada biaya iklan tercatat di periode ini.'
      : (perm.money
        ? '<strong>ROAS platform</strong> pakai nilai konversi yang dilaporkan Meta/TikTok — hanya penjualan yang mereka klaim. ' +
          '<strong>ROAS blended</strong> membagi <em>seluruh</em> penjualan toko dengan biaya iklan, jadi termasuk pembeli yang datang bukan dari iklan. ' +
          'Angka blended selalu lebih besar; pakai yang platform untuk menilai iklan, yang blended untuk menilai bisnis.'
        : '<strong>ROAS platform</strong> memakai nilai konversi yang dilaporkan Meta/TikTok — penjualan yang mereka klaim berasal dari iklan.');

    document.getElementById('eff-chart').innerHTML = effChart(cur, ads);
    document.getElementById('eff-legend').innerHTML =
      '<span><span class="swatch" style="background:var(--kriuk)"></span>CPC (skala kiri)</span>' +
      '<span><span class="swatch" style="background:var(--ember);border-radius:50%"></span>CTR (skala kanan)</span>';

    // --- tabel perbandingan channel ---
    document.getElementById('table-sub').textContent = periodLabel;
    var cols = ['Channel', 'Biaya', 'Impresi', 'Klik', 'CTR', 'CPC', 'CPM', 'Hasil', 'Biaya/hasil', 'ROAS'];
    var rowHtml = function (label, color, x, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' +
        (color ? '<span class="swatch" style="background:' + color + '"></span>' : '') + label + '</td>' +
        '<td>' + rupiah(x.spend) + '</td>' +
        '<td>' + num(x.impressions) + '</td>' +
        '<td>' + num(x.clicks) + '</td>' +
        '<td>' + (x.ctr ? dec(x.ctr) + '%' : '—') + '</td>' +
        '<td>' + (x.cpc ? rupiah(x.cpc) : '—') + '</td>' +
        '<td>' + (x.cpm ? rupiah(x.cpm) : '—') + '</td>' +
        '<td>' + num(x.results) + '</td>' +
        '<td>' + (x.cpa ? rupiah(x.cpa) : '—') + '</td>' +
        '<td>' + (x.roas ? dec(x.roas, 1) + '×' : '—') + '</td></tr>';
    };
    document.getElementById('channel-table').innerHTML =
      '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      CHANNELS.map(function (c) { return rowHtml(c.label, c.color, derive(byChannel[c.key])); }).join('') +
      rowHtml('Total', '', m, 'tot') + '</tbody>';

    // --- catatan promo ---
    var noteDays = cur.filter(function (d) { return notes[d]; }).reverse();
    document.getElementById('note-list').innerHTML = noteDays.length
      ? noteDays.slice(0, 8).map(function (d) {
          return '<li><span class="when num">' + shortLabel(d) + '</span><span class="what">' + esc(notes[d]) + '</span></li>';
        }).join('')
      : '<li><span class="empty">Belum ada promo dicatat.</span></li>';
  }

  async function renderRecap(cur, prev, sales, ads, notes) {
    var revNow = sumRange(cur, sales), revPrev = sumRange(prev, sales);
    var revPct = pct(revNow, revPrev);
    var spendNow = cur.reduce(function (a, d) { return a + daySpend(ads[d]); }, 0);
    var spendPrev = prev.reduce(function (a, d) { return a + daySpend(ads[d]); }, 0);
    var spendPct = pct(spendNow, spendPrev);
    var roas = spendNow ? revNow / spendNow : 0;
    var adTotals = derive(cur.reduce(function (acc, d) {
      CHANNELS.forEach(function (c) { addAd(acc, ads[d][c.key]); });
      return acc;
    }, emptyAd()));

    var work = await DB.getWork();
    var inPeriod = work.filter(function (w) { return w.work_date >= cur[0] && w.work_date <= cur[cur.length - 1]; });
    var doneCount = inPeriod.filter(function (w) { return w.done; }).length;
    var workPct = inPeriod.length ? Math.round((doneCount / inPeriod.length) * 100) : 0;

    var social = await DB.getSocialHistory(60);
    var latest = social[social.length - 1], base = null;
    for (var i = social.length - 1; i >= 0; i--) {
      if (social[i].entry_date < cur[0]) { base = social[i]; break; }
    }
    if (!base) base = social[0];

    document.getElementById('recap-period').textContent =
      shortLabel(cur[0]) + ' – ' + shortLabel(cur[cur.length - 1]) + ' · dibanding ' + range + ' hari sebelumnya';

    var chip = function (p) {
      if (p === null) return '<div class="hint">belum ada pembanding</div>';
      return '<div class="hint ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '↑ +' : '↓ ') + p + '% vs periode lalu</div>';
    };
    document.getElementById('recap-kpi').innerHTML =
      '<div class="tile"><div class="label">Penjualan</div><div class="value num">' + rupiah(revNow) + '</div>' + chip(revPct) + '</div>' +
      '<div class="tile"><div class="label">Biaya iklan</div><div class="value num">' + rupiah(spendNow) + '</div>' + chip(spendPct) + '</div>' +
      '<div class="tile accent"><div class="label">ROAS</div><div class="value num">' + (spendNow ? roas.toFixed(1).replace('.', ',') + '×' : '—') + '</div>' +
        '<div class="hint">' + (spendNow ? 'per Rp1 iklan' : 'isi biaya iklan dulu') + '</div></div>' +
      '<div class="tile"><div class="label">Pekerjaan Sulthan</div><div class="value num">' + (inPeriod.length ? workPct + '%' : '—') + '</div>' +
        '<div class="hint">' + (inPeriod.length ? doneCount + ' dari ' + inPeriod.length + ' selesai' : 'belum ada jadwal') + '</div></div>';

    var totals = cur.map(function (d) { return { d: d, v: dayTotal(sales[d]) }; }).filter(function (x) { return x.v > 0; });
    var best = totals.slice().sort(function (a, b) { return b.v - a.v; })[0];
    var worst = totals.slice().sort(function (a, b) { return a.v - b.v; })[0];
    var bt = BRANCHES.map(function (b) {
      return { label: b.label, v: cur.reduce(function (s, d) { return s + branchTotal(sales[d][b.key]); }, 0) };
    }).sort(function (a, b) { return b.v - a.v; });

    var facts = [];
    if (best) facts.push('Hari terbaik: <strong>' + dayInitial(best.d) + ' ' + shortLabel(best.d) + '</strong> — ' + rupiah(best.v) +
      (worst && worst.d !== best.d ? ' · terendah ' + dayInitial(worst.d) + ' ' + shortLabel(worst.d) + ' (' + rupiah(worst.v) + ')' : ''));
    if (bt[0].v) facts.push('Cabang teratas: <strong>' + bt[0].label + '</strong> ' + rupiah(bt[0].v) + ' vs ' + bt[1].label + ' ' + rupiah(bt[1].v));
    if (revNow) facts.push('Rata-rata harian: <strong>' + rupiah(Math.round(revNow / range)) + '</strong>');
    if (latest) {
      facts.push('Follower: ' + PLATFORMS.map(function (p) {
        var n = Number(latest[p.key]) || 0, w = base ? Number(base[p.key]) || 0 : 0, diff = n - w;
        return p.label + ' <strong>' + n.toLocaleString('id-ID') + '</strong>' + (diff ? ' (' + (diff > 0 ? '+' : '') + diff.toLocaleString('id-ID') + ')' : '');
      }).join(' · '));
    }
    document.getElementById('recap-facts').innerHTML = facts.map(function (f) { return '<div>' + f + '</div>'; }).join('');

    // teks rekap untuk ditempel ke WhatsApp
    var L = [];
    L.push('*Rekap Crackling — ' + shortLabel(cur[0]) + ' s/d ' + shortLabel(cur[cur.length - 1]) + '*', '');
    L.push('*PENJUALAN*');
    L.push('Total: ' + rupiah(revNow) + (revPct !== null ? ' (' + (revPct >= 0 ? '+' : '') + revPct + '% vs periode lalu)' : ''));
    BRANCHES.forEach(function (b) {
      var v = cur.reduce(function (s, d) { return s + branchTotal(sales[d][b.key]); }, 0);
      L.push('• ' + b.label + ': ' + rupiah(v) + (revNow ? ' (' + Math.round((v / revNow) * 100) + '%)' : ''));
    });
    SOURCES.forEach(function (s) {
      L.push('• ' + s.label + ': ' + rupiah(cur.reduce(function (sum, d) {
        return sum + BRANCHES.reduce(function (a, b) { return a + sales[d][b.key][s.key]; }, 0);
      }, 0)));
    });
    if (best) L.push('Hari terbaik: ' + dayInitial(best.d) + ' ' + shortLabel(best.d) + ' — ' + rupiah(best.v));
    L.push('Rata-rata harian: ' + rupiah(Math.round(revNow / range)), '');
    L.push('*IKLAN*');
    L.push('Total biaya: ' + rupiah(spendNow) + (spendPct !== null ? ' (' + (spendPct >= 0 ? '+' : '') + spendPct + '%)' : ''));
    CHANNELS.forEach(function (c) {
      var cs = cur.reduce(function (a, d) { return a + ads[d][c.key].spend; }, 0);
      if (cs) L.push('• ' + c.label + ': ' + rupiah(cs) + (spendNow ? ' (' + Math.round((cs / spendNow) * 100) + '%)' : ''));
    });
    if (adTotals.impressions || adTotals.clicks) {
      L.push('Impresi ' + adTotals.impressions.toLocaleString('id-ID') + ' · Klik ' + adTotals.clicks.toLocaleString('id-ID') +
        (adTotals.ctr ? ' · CTR ' + adTotals.ctr.toFixed(2).replace('.', ',') + '%' : ''));
      L.push('CPC ' + (adTotals.cpc ? rupiah(adTotals.cpc) : '—') + ' · CPM ' + (adTotals.cpm ? rupiah(adTotals.cpm) : '—'));
    }
    if (adTotals.results) {
      L.push('Hasil ' + adTotals.results.toLocaleString('id-ID') + ' · Biaya per hasil ' + rupiah(adTotals.cpa));
    }
    L.push('ROAS platform: ' + (adTotals.roas ? adTotals.roas.toFixed(1).replace('.', ',') + '×' : '—') +
      ' · ROAS blended: ' + (spendNow ? roas.toFixed(1).replace('.', ',') + '×' : '—') +
      (revNow && spendNow ? ' · rasio iklan ' + ((spendNow / revNow) * 100).toFixed(1).replace('.', ',') + '%' : ''));
    var promos = cur.filter(function (d) { return notes[d]; });
    if (promos.length) {
      L.push('Promo:');
      promos.forEach(function (d) { L.push('• ' + notes[d] + ' (' + shortLabel(d) + ')'); });
    }
    L.push('', '*SOCIAL MEDIA*');
    if (latest) {
      PLATFORMS.forEach(function (p) {
        var n = Number(latest[p.key]) || 0, w = base ? Number(base[p.key]) || 0 : 0, diff = n - w;
        L.push('• ' + p.label + ': ' + n.toLocaleString('id-ID') + (diff ? ' (' + (diff > 0 ? '+' : '') + diff.toLocaleString('id-ID') + ')' : ''));
      });
    } else L.push('Belum ada data.');
    L.push('', '*JADWAL KERJA — SULTHAN*');
    L.push(inPeriod.length ? 'Selesai ' + doneCount + ' dari ' + inPeriod.length + ' pekerjaan (' + workPct + '%)' : 'Belum ada jadwal di periode ini.');
    var late = work.filter(function (w) { return !w.done && w.work_date < dateStr(); });
    if (late.length) L.push('Lewat tanggal & belum selesai: ' + late.length);
    recapText = L.join('\n');
  }

  // ---------- jadwal kerja ----------
  var calY, calM, selectedDate = dateStr();

  function workItemHtml(w, showDate) {
    var late = !w.done && w.work_date < dateStr();
    return '<li class="' + (w.done ? 'done' : '') + '">' +
      '<input type="checkbox" data-work="' + w.id + '"' + (w.done ? ' checked' : '') + ' aria-label="' + esc(w.title) + '">' +
      '<span class="body"><span class="t">' + esc(w.title) + '</span>' +
      '<span class="m"><span class="chip ' + w.scope + '">' + (w.scope === 'panjang' ? 'jangka panjang' : 'jangka pendek') + '</span>' +
      (showDate ? ' ' + longDate(w.work_date) : '') +
      (late ? ' <span class="chip late">lewat tanggal</span>' : '') + '</span></span>' +
      '<button class="del" data-delwork="' + w.id + '" aria-label="Hapus pekerjaan: ' + esc(w.title) + '" title="Hapus">&times;</button></li>';
  }

  function wireWorkList(el) {
    el.querySelectorAll('[data-work]').forEach(function (cb) {
      cb.addEventListener('change', async function () {
        await DB.setWorkDone(cb.getAttribute('data-work'), cb.checked);
        renderWork();
        refresh();
      });
    });
    el.querySelectorAll('[data-delwork]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Hapus pekerjaan ini? Tidak bisa dibatalkan.')) return;
        await DB.deleteWork(btn.getAttribute('data-delwork'));
        renderWork();
        refresh();
      });
    });
  }

  async function renderWork() {
    var work = await DB.getWork();
    var today = dateStr();

    // statistik
    var weekEnd = shiftDays(6);
    var thisWeek = work.filter(function (w) { return w.work_date >= today && w.work_date <= weekEnd; });
    var late = work.filter(function (w) { return !w.done && w.work_date < today; });
    var longTerm = work.filter(function (w) { return w.scope === 'panjang' && !w.done; });
    var doneWeek = thisWeek.filter(function (w) { return w.done; }).length;

    document.getElementById('work-stats').innerHTML =
      '<div class="tile"><div class="label">7 hari ke depan</div><div class="value num">' + thisWeek.length + '</div><div class="hint">pekerjaan terjadwal</div></div>' +
      '<div class="tile"><div class="label">Sudah selesai</div><div class="value num">' + doneWeek + '</div><div class="hint">dari ' + thisWeek.length + ' pekerjaan</div></div>' +
      '<div class="tile' + (late.length ? ' warn' : '') + '"><div class="label">Lewat tanggal</div><div class="value num">' + late.length + '</div><div class="hint">belum dicentang</div></div>' +
      '<div class="tile"><div class="label">Jangka panjang</div><div class="value num">' + longTerm.length + '</div><div class="hint">masih berjalan</div></div>';

    // kalender
    if (calY === undefined) { var n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); }
    document.getElementById('cal-month').textContent = monthName(calY, calM);
    document.getElementById('cal-dow').innerHTML = DOW.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');

    var first = new Date(calY, calM, 1);
    var offset = (first.getDay() + 6) % 7; // Senin = 0
    var daysInMonth = new Date(calY, calM + 1, 0).getDate();
    var cells = '';
    for (var b = 0; b < offset; b++) cells += '<div class="cal-cell blank"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = dateStr(new Date(calY, calM, day));
      var items = work.filter(function (w) { return w.work_date === ds; });
      var dots = items.slice(0, 4).map(function (w) {
        return '<span class="dot ' + (w.done ? 'done' : w.scope === 'panjang' ? 'long' : '') + '"></span>';
      }).join('');
      cells += '<button type="button" class="cal-cell' + (ds === today ? ' today' : '') + '" data-day="' + ds + '"' +
        ' aria-pressed="' + (ds === selectedDate) + '" aria-label="' + longDate(ds) + ', ' + items.length + ' pekerjaan">' +
        '<span class="dnum">' + day + '</span>' +
        '<span class="dots">' + dots + '</span>' +
        (items.length > 4 ? '<span class="more">+' + (items.length - 4) + '</span>' : '') +
        '</button>';
    }
    var grid = document.getElementById('cal-grid');
    grid.innerHTML = cells;
    grid.querySelectorAll('[data-day]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedDate = btn.getAttribute('data-day');
        renderWork();
      });
    });

    // daftar pekerjaan tanggal terpilih
    document.getElementById('work-day-title').textContent = 'Pekerjaan ' + longDate(selectedDate);
    var dayItems = work.filter(function (w) { return w.work_date === selectedDate; });
    document.getElementById('work-day-sub').textContent = dayItems.length
      ? dayItems.filter(function (w) { return w.done; }).length + ' dari ' + dayItems.length + ' selesai'
      : 'Belum ada pekerjaan di tanggal ini';
    var list = document.getElementById('work-list');
    list.innerHTML = dayItems.length
      ? dayItems.map(function (w) { return workItemHtml(w, false); }).join('')
      : '<li><span class="empty">Kosong. Tambahkan lewat form di bawah.</span></li>';
    wireWorkList(list);

    var lateEl = document.getElementById('work-late');
    lateEl.innerHTML = late.length
      ? late.map(function (w) { return workItemHtml(w, true); }).join('')
      : '<li><span class="empty">Tidak ada yang terlewat. Aman.</span></li>';
    wireWorkList(lateEl);

    var longEl = document.getElementById('work-long');
    longEl.innerHTML = longTerm.length
      ? longTerm.map(function (w) { return workItemHtml(w, true); }).join('')
      : '<li><span class="empty">Belum ada rencana jangka panjang.</span></li>';
    wireWorkList(longEl);
  }

  function wireWork() {
    document.getElementById('cal-prev').addEventListener('click', function () {
      calM--; if (calM < 0) { calM = 11; calY--; }
      renderWork();
    });
    document.getElementById('cal-next').addEventListener('click', function () {
      calM++; if (calM > 11) { calM = 0; calY++; }
      renderWork();
    });
    onSubmit('work-form', async function () {
      var input = document.getElementById('w-title');
      var title = input.value.trim();
      if (!title) return;
      await DB.addWork({ work_date: selectedDate, title: title, scope: document.getElementById('w-scope').value });
      input.value = '';
      say('work-saved', 'Ditambahkan ke ' + longDate(selectedDate));
      renderWork();
      refresh();
    });
  }

  // ---------- social media ----------
  async function renderSocial() {
    var history = await DB.getSocialHistory(30);
    var latest = history[history.length - 1], prev = history[history.length - 2];

    document.getElementById('social-sub').textContent = latest
      ? 'Dicatat terakhir ' + longDate(latest.entry_date) : 'Belum ada data — isi lewat form di bawah.';

    document.getElementById('social-grid').innerHTML = PLATFORMS.map(function (p) {
      var series = history.map(function (h) { return Number(h[p.key]) || 0; });
      var now = latest ? Number(latest[p.key]) || 0 : 0;
      var before = prev ? Number(prev[p.key]) || 0 : 0;
      var diff = now - before, meta;
      if (!latest) meta = 'Belum ada data';
      else if (!prev) meta = 'Catatan pertama';
      else if (diff === 0) meta = 'Tidak berubah sejak ' + shortLabel(prev.entry_date);
      else meta = (diff > 0 ? '+' : '') + diff.toLocaleString('id-ID') + ' sejak ' + shortLabel(prev.entry_date);
      return '<div class="social"><div class="name"><span class="ico" style="background:' + p.bg + '"></span>' + p.label + '</div>' +
        '<div class="count num">' + now.toLocaleString('id-ID') + '</div>' +
        '<div class="meta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') + '">' + meta + '</div>' +
        '<div class="spark">' + sparkline(series, p.line) + '</div></div>';
    }).join('');

    if (latest) {
      document.getElementById('so-ig').value = latest.instagram || '';
      document.getElementById('so-tt').value = latest.tiktok || '';
      document.getElementById('so-th').value = latest.threads || '';
    }
  }

  // ---------- form ----------
  async function fillSalesForm() {
    var d = document.getElementById('s-date').value || dateStr();
    var branch = document.getElementById('s-branch').value || BRANCHES[0].key;
    var sales = await DB.getSales([d]);
    var r = sales[d][branch] || emptySale();
    document.getElementById('s-esb').value = r.esb || '';
    document.getElementById('s-gojek').value = r.gojek_grab || '';
    document.getElementById('s-paper').value = r.paper || '';
  }

  var AD_INPUTS = {
    spend: 'a-spend', impressions: 'a-impr', reach: 'a-reach',
    clicks: 'a-clicks', results: 'a-results', result_value: 'a-value'
  };

  async function fillAdsForm() {
    var d = document.getElementById('a-date').value || dateStr();
    var ch = document.getElementById('a-channel').value || CHANNELS[0].key;
    var ads = await DB.getAds([d]);
    var row = ads[d][ch] || emptyAd();
    AD_FIELDS.forEach(function (f) {
      document.getElementById(AD_INPUTS[f]).value = row[f] || '';
    });
  }

  async function fillNoteForm() {
    var d = document.getElementById('n-date').value || dateStr();
    var notes = await DB.getNotes([d]);
    document.getElementById('n-note').value = notes[d] || '';
  }

  // submit handler yang menonaktifkan tombol selama penyimpanan
  function onSubmit(formId, handler) {
    var form = document.getElementById(formId);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      if (btn.disabled) return;
      btn.disabled = true;
      try { await handler(); } finally { btn.disabled = false; }
    });
  }

  function wireForms() {
    var branchSel = document.getElementById('s-branch');
    branchSel.innerHTML = BRANCHES.map(function (b) {
      return '<option value="' + b.key + '">' + b.label + '</option>';
    }).join('');
    var chanSel = document.getElementById('a-channel');
    chanSel.innerHTML = CHANNELS.map(function (c) {
      return '<option value="' + c.key + '">' + c.label + '</option>';
    }).join('');

    document.getElementById('s-date').value = dateStr();
    document.getElementById('a-date').value = dateStr();
    document.getElementById('n-date').value = dateStr();
    document.getElementById('so-date').value = dateStr();
    document.getElementById('s-date').addEventListener('change', fillSalesForm);
    branchSel.addEventListener('change', fillSalesForm);
    document.getElementById('a-date').addEventListener('change', fillAdsForm);
    chanSel.addEventListener('change', fillAdsForm);
    document.getElementById('n-date').addEventListener('change', fillNoteForm);

    onSubmit('sales-form', async function () {
      await DB.saveSales(document.getElementById('s-date').value, branchSel.value, {
        esb: Number(document.getElementById('s-esb').value) || 0,
        gojek_grab: Number(document.getElementById('s-gojek').value) || 0,
        paper: Number(document.getElementById('s-paper').value) || 0
      });
      say('sales-saved', 'Penjualan tersimpan');
      refresh();
    });

    onSubmit('ads-form', async function () {
      var vals = {};
      AD_FIELDS.forEach(function (f) {
        vals[f] = Number(document.getElementById(AD_INPUTS[f]).value) || 0;
      });
      var ch = chanSel.value;
      await DB.saveAd(document.getElementById('a-date').value, ch, vals);
      var label = CHANNELS.filter(function (c) { return c.key === ch; })[0].label;
      say('ads-saved', 'Data ' + label + ' tersimpan');
      refresh();
    });

    onSubmit('note-form', async function () {
      await DB.saveNote(document.getElementById('n-date').value, document.getElementById('n-note').value.trim());
      say('note-saved', 'Catatan promo tersimpan');
      refresh();
    });

    onSubmit('budget-form', async function () {
      await DB.saveBudget(monthKey(), Number(document.getElementById('b-amount').value) || 0);
      say('ads-saved', 'Budget tersimpan');
      refresh();
    });

    onSubmit('social-form', async function () {
      await DB.saveSocial(document.getElementById('so-date').value, {
        instagram: Number(document.getElementById('so-ig').value) || 0,
        tiktok: Number(document.getElementById('so-tt').value) || 0,
        threads: Number(document.getElementById('so-th').value) || 0
      });
      say('social-saved', 'Angka social media tersimpan');
      renderSocial();
      refresh();
    });

    document.getElementById('copy-recap').addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(recapText);
      } catch (e) {
        var ta = document.createElement('textarea');
        ta.value = recapText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      say('recap-saved', 'Rekap tersalin — tinggal paste ke grup');
    });

    document.querySelectorAll('[data-range]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        range = Number(btn.getAttribute('data-range'));
        document.querySelectorAll('[data-range]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        refresh();
      });
    });

    fillAdsForm();
    fillNoteForm();
  }

  function say(id, msg) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2500);
  }

  // ---------- navigasi ----------
  function allowedPages() {
    var out = [];
    if (perm.money) out.push('ringkasan');
    out.push('penjualan');            // semua peran: minimal boleh mengisi
    if (perm.ads) out.push('iklan');
    if (perm.social) out.push('sosial');
    out.push('jadwal');
    return out;
  }

  function showPage(name) {
    var allowed = allowedPages();
    if (allowed.indexOf(name) === -1) name = allowed[0];
    PAGES.forEach(function (p) {
      document.getElementById('page-' + p).classList.toggle('active', p === name);
    });
    document.querySelectorAll('.nav-item').forEach(function (a) {
      if (a.getAttribute('data-page') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // Sembunyikan bagian yang tidak boleh dilihat peran ini.
  // Ini hanya kerapian tampilan — penolakan sesungguhnya dilakukan RLS di database.
  function applyPermissions() {
    var allowed = allowedPages();
    document.querySelectorAll('.nav-item').forEach(function (a) {
      a.hidden = allowed.indexOf(a.getAttribute('data-page')) === -1;
    });
    // Penjualan: peran tanpa akses uang hanya melihat form input
    document.querySelectorAll('#page-penjualan [data-money]').forEach(function (el) {
      el.hidden = !perm.money;
    });
    var notice = document.getElementById('sales-notice');
    if (notice) notice.hidden = perm.money;
    // ROAS blended butuh data penjualan, jadi hanya untuk yang boleh lihat uang
    document.body.classList.toggle('no-money', !perm.money);
  }

  function showLogin(msg) {
    document.getElementById('auth-gate').hidden = false;
    document.querySelector('.shell').hidden = true;
    var err = document.getElementById('login-error');
    err.textContent = msg || '';
    err.hidden = !msg;
  }

  async function startApp(profile) {
    me = profile;
    perm = PERMS[profile.role] || PERMS.social;

    document.getElementById('auth-gate').hidden = true;
    document.querySelector('.shell').hidden = false;
    document.getElementById('today-label').textContent = longDate(dateStr());
    document.getElementById('me-name').textContent = profile.name;
    document.getElementById('me-role').textContent = ROLE_LABEL[profile.role] || profile.role;

    applyPermissions();
    showPage((location.hash || '').replace('#', ''));

    wireForms();
    wireWork();
    if (perm.money) renderNumbers();
    else renderAdsOnly();
    if (perm.social) renderSocial();
    renderWork();
  }

  // Peran tanpa akses penjualan: tetap butuh angka iklan, tapi tanpa data omzet.
  async function renderAdsOnly() {
    if (!perm.ads) return;
    var dates = lastNDates(range * 2);
    var cur = dates.slice(range), prev = dates.slice(0, range);
    var empty = {};
    dates.forEach(function (d) {
      empty[d] = {};
      BRANCHES.forEach(function (b) { empty[d][b.key] = emptySale(); });
    });
    var ads = await DB.getAds(dates);
    var notes = await DB.getNotes(dates);
    await renderAds(cur, prev, empty, ads, notes);
  }

  function refresh() {
    if (perm.money) renderNumbers();
    else renderAdsOnly();
  }

  async function boot() {
    var session = await Auth.session();
    if (!session) { showLogin(); return; }
    var profile = await Auth.profile(session.user.id);
    if (!profile) {
      await Auth.signOut();
      showLogin('Akun ini belum diberi peran. Minta owner menjalankan perintah penetapan peran di Supabase.');
      return;
    }
    startApp(profile);
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.addEventListener('hashchange', function () {
      showPage(location.hash.replace('#', ''));
    });

    document.getElementById('login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      var res = await Auth.signIn(
        toEmail(document.getElementById('login-email').value),
        document.getElementById('login-password').value
      );
      btn.disabled = false;
      if (res.error) {
        showLogin(res.error.message === 'Invalid login credentials'
          ? 'Username atau password salah.' : res.error.message);
        return;
      }
      boot();
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await Auth.signOut();
      location.reload();
    });

    boot();
  });
})();
