// Papan Marketing Crackling — data, grafik, jadwal kerja.
// Data ada di Supabase. Siapa boleh melihat apa ditentukan oleh Row Level Security
// di supabase-schema.sql; penyembunyian menu di sini hanya supaya tampilannya rapi,
// bukan pengaman. Pengamannya ada di database.
(function () {
  'use strict';

  var cfg = window.SUPABASE_CONFIG || {};
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  // Sesi login disimpan di localStorage. Sebagian browser (Edge dengan Tracking
  // Prevention, Safari, mode privat) bisa memblokirnya — akibatnya login berhasil
  // tapi sesinya hilang seketika dan pengguna terlempar balik ke layar masuk.
  // Dicek di awal supaya bisa diberi tahu, bukan gagal tanpa keterangan.
  function storageBisaDipakai() {
    try {
      localStorage.setItem('__cek', '1');
      localStorage.removeItem('__cek');
      return true;
    } catch (e) {
      return false;
    }
  }

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
    // Ambil profil + peran. Kembalikan errornya juga supaya kegagalan baca
    // (misal ditolak RLS) tidak tersamar jadi "belum diberi peran".
    async profile(userId) {
      return await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
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
    // total biaya iklan satu bulan kalender, semua channel.
    // Batas akhir dihitung dari panjang bulan sebenarnya — "-31" bikin Postgres
    // menolak dengan "date/time field value out of range" di bulan 30 hari.
    async getMonthSpend(mk) {
      var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
      var akhir = dateStr(new Date(y, m, 0));   // hari 0 bulan berikutnya = hari terakhir bulan ini
      var res = await sb.from('ad_daily').select('spend')
        .gte('entry_date', mk + '-01').lte('entry_date', akhir);
      return (res.data || []).reduce(function (s, r) { return s + (Number(r.spend) || 0); }, 0);
    },

    async getSocialHistory(limit) {
      var res = await sb.from('social_daily').select('*').order('entry_date', { ascending: false }).limit(limit);
      return (res.data || []).reverse();
    },
    async saveSocial(date, vals) {
      return await sb.from('social_daily').upsert(Object.assign({ entry_date: date }, vals), { onConflict: 'entry_date' });
    },

    // --- task ---
    // RLS sudah membatasi: PIC-nya, pemberi tugasnya, atau owner/lead.
    async getTasks() {
      var res = await sb.from('tasks').select('*').order('deadline');
      return res.data || [];
    },
    async addTask(item) {
      return await sb.from('tasks').insert(Object.assign({ created_by: me.id }, item));
    },
    async setTaskStatus(id, status) {
      var patch = { status: status, done_at: status === 'done' ? new Date().toISOString() : null };
      return await sb.from('tasks').update(patch).eq('id', id);
    },
    async deleteTask(id) {
      return await sb.from('tasks').delete().eq('id', id);
    },
    // daftar rekan setim, untuk memilih PIC
    async getMembers() {
      var res = await sb.from('profiles').select('id,name,role').order('name');
      return res.data || [];
    },

    // --- target omzet bulanan ---
    // Kunci map: 'sumber|cabang', mis. 'esb|gading_serpong' atau 'paper|semua'
    async getTargets(month) {
      var map = {};
      var res = await sb.from('targets').select('*').eq('month', month);
      (res.data || []).forEach(function (r) {
        map[r.source + '|' + r.branch] = Number(r.revenue_target) || 0;
      });
      return map;
    },
    async saveTarget(month, source, branch, amount) {
      return await sb.from('targets').upsert(
        { month: month, source: source, branch: branch, revenue_target: amount },
        { onConflict: 'month,source,branch' }
      );
    }
  };

  // ---------- helper hitung ----------
  // Rentang tanggal yang sedang dilihat. Default 30 hari terakhir.
  var dFrom = shiftDays(-29), dTo = dateStr();
  var range = 30;   // jumlah hari dalam rentang, dipakai untuk rata-rata & pembanding

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000) + 1;
  }
  function datesBetween(a, b) {
    var out = [], d = new Date(a + 'T00:00:00'), end = new Date(b + 'T00:00:00');
    while (d <= end) {
      out.push(dateStr(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  // tanggal periode sekarang + periode sebelumnya yang sama panjang, untuk perbandingan
  function periode() {
    var cur = datesBetween(dFrom, dTo);
    var n = cur.length;
    var prevTo = dateStr(new Date(new Date(dFrom + 'T00:00:00').getTime() - 86400000));
    var prevFrom = dateStr(new Date(new Date(prevTo + 'T00:00:00').getTime() - (n - 1) * 86400000));
    return { cur: cur, prev: datesBetween(prevFrom, prevTo) };
  }
  function labelPeriode() {
    return longDate(dFrom) + ' – ' + longDate(dTo) + ' · ' + range + ' hari';
  }
  var recapText = '';
  var adsRecapText = '';

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
    var p = periode();
    var cur = p.cur, prev = p.prev;
    var dates = prev.concat(cur);
    var sales = await DB.getSales(dates);
    var ads = await DB.getAds(dates);
    var notes = await DB.getNotes(dates);

    renderSales(cur, sales, ads, notes);
    await renderTarget();
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
    var byChannelPrev = {};
    CHANNELS.forEach(function (c) { byChannelPrev[c.key] = emptyAd(); });
    prev.forEach(function (d) {
      CHANNELS.forEach(function (c) { addAd(byChannelPrev[c.key], ads[d][c.key]); });
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

    // --- sorotan performa: channel mana membaik / perlu dicek vs periode lalu ---
    var hl = buildHighlights(byChannel, byChannelPrev);
    document.getElementById('hl-good').innerHTML = highlightRowsHtml(hl.good, dec);
    document.getElementById('hl-watch').innerHTML = highlightRowsHtml(hl.watch, dec);

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

    // --- catatan promo, dengan dampaknya ke omzet (gaya "campaign -> sales") ---
    // Baseline = rata-rata omzet hari TANPA promo di periode ini. Hanya berarti untuk
    // peran yang boleh melihat uang — untuk peran ads-only, `sales` datang kosong semua.
    var noteDays = cur.filter(function (d) { return notes[d]; }).reverse();
    var baseDays = cur.filter(function (d) { return !notes[d] && dayTotal(sales[d]) > 0; });
    var baseAvg = baseDays.length ? baseDays.reduce(function (a, d) { return a + dayTotal(sales[d]); }, 0) / baseDays.length : 0;
    var promoImpact = {};
    noteDays.forEach(function (d) {
      var v = dayTotal(sales[d]);
      promoImpact[d] = { v: v, pct: baseAvg ? Math.round(((v - baseAvg) / baseAvg) * 100) : null };
    });
    document.getElementById('note-list').innerHTML = noteDays.length
      ? noteDays.slice(0, 8).map(function (d) {
          var badge = '';
          if (perm.money && baseAvg) {
            var info = promoImpact[d];
            var cls = info.pct === null ? 'flat' : info.pct >= 0 ? 'up' : 'down';
            badge = '<span class="promo-impact ' + cls + '">' + rupiah(info.v) +
              (info.pct !== null ? ' · ' + (info.pct >= 0 ? '+' : '') + info.pct + '%' : '') + '</span>';
          }
          return '<li><span class="when num">' + shortLabel(d) + '</span><span class="what">' + esc(notes[d]) + '</span>' + badge + '</li>';
        }).join('')
      : '<li><span class="empty">Belum ada promo dicatat.</span></li>';

    // --- teks performa iklan untuk WhatsApp ---
    var chSpend = CHANNELS.map(function (c) {
      return { label: c.label, v: byChannel[c.key].spend };
    }).sort(function (a, b) { return b.v - a.v; });
    var AL = [];
    AL.push('*Performa Iklan Crackling — ' + longDate(cur[0]) + ' s/d ' + longDate(cur[cur.length - 1]) + '*', '');
    AL.push('Total biaya: ' + rupiah(spend) + (sp !== null ? ' (' + (sp >= 0 ? '+' : '') + sp + '% vs periode lalu)' : ''));
    chSpend.forEach(function (c) { if (c.v) AL.push('• ' + c.label + ': ' + rupiah(c.v) + ' (' + Math.round((c.v / spend) * 100) + '%)'); });
    AL.push('', 'Impresi ' + num(m.impressions) + ' · Klik ' + num(m.clicks) + (m.ctr ? ' · CTR ' + dec(m.ctr) + '%' : ''));
    AL.push('CPC ' + (m.cpc ? rupiah(m.cpc) : '—') + ' · CPM ' + (m.cpm ? rupiah(m.cpm) : '—'));
    if (m.results) AL.push('Hasil ' + num(m.results) + ' · Biaya/hasil ' + rupiah(m.cpa));
    AL.push('ROAS platform: ' + (m.roas ? dec(m.roas, 1) + '×' : '—') +
      (perm.money && spend ? ' · ROAS blended: ' + dec(blendedRoas, 1) + '×' : ''));
    if (hl.good.length || hl.watch.length) {
      AL.push('');
      if (hl.good.length) { AL.push('Membaik:'); hl.good.forEach(function (r) { AL.push('• ' + r.channel + ' · ' + r.metric + ' ' + (r.change >= 0 ? '↑ +' : '↓ ') + Math.round(Math.abs(r.change)) + '%'); }); }
      if (hl.watch.length) { AL.push('Perlu diperhatikan:'); hl.watch.forEach(function (r) { AL.push('• ' + r.channel + ' · ' + r.metric + ' ' + (r.change >= 0 ? '↑ +' : '↓ ') + Math.round(Math.abs(r.change)) + '%'); }); }
    }
    if (noteDays.length) {
      AL.push('', 'Promo yang jalan:');
      noteDays.slice(0, 8).forEach(function (d) {
        var info = promoImpact[d];
        AL.push('• ' + notes[d] + ' (' + shortLabel(d) + ')' +
          (perm.money && baseAvg ? ' — ' + rupiah(info.v) + (info.pct !== null ? ' (' + (info.pct >= 0 ? '+' : '') + info.pct + '% vs hari biasa)' : '') : ''));
      });
    }
    adsRecapText = AL.join('\n');
  }

  // Satu baris rincian: nama, nilai, persentase, dan batang proporsi.
  function brkRow(label, color, value, total, fmt) {
    var p = total ? Math.round((value / total) * 100) : 0;
    return '<div class="r">' +
      '<span class="swatch" style="background:' + color + '"></span>' +
      '<span class="nm">' + label + '</span>' +
      '<span class="vl">' + fmt(value) + '</span>' +
      '<span class="pc">' + p + '%</span>' +
      '<span class="bar"><i style="width:' + p + '%;background:' + color + '"></i></span>' +
      '</div>';
  }
  function brkWrap(html) { return '<div class="brk">' + (html || '<span class="none">Belum ada data.</span>') + '</div>'; }

  function deltaHtml(now, before, suffix) {
    var p = pct(now, before);
    if (p === null) return '<span class="flat">belum ada pembanding periode lalu</span>';
    var naik = p >= 0;
    return '<span class="' + (naik ? 'up' : 'down') + '">' + (naik ? '↑ +' : '↓ ') + p + '%</span>' +
      ' <span class="flat">vs periode lalu' + (suffix || '') + '</span>';
  }

  // ---------- sorotan performa channel (gaya "top/bottom performing metrics") ----------
  // Untuk tiap channel yang aktif periode ini, bandingkan CTR/CPC/ROAS/biaya-per-hasil
  // dengan periode sebelumnya. Dipisah dua kelompok: yang membaik dan yang perlu dicek.
  var HL_METRICS = { ctr: 'CTR', cpc: 'CPC', roas: 'ROAS', cpa: 'Biaya/hasil' };
  function metricGoodDir(k) { return (k === 'ctr' || k === 'roas') ? 1 : -1; } // 1 = naik itu bagus
  function buildHighlights(byChannel, byChannelPrev) {
    var rows = [];
    CHANNELS.forEach(function (c) {
      var now = derive(byChannel[c.key]), prev = derive(byChannelPrev[c.key]);
      if (!now.spend) return; // channel tak dipakai periode ini, lewati
      Object.keys(HL_METRICS).forEach(function (k) {
        // hindari "biaya turun jadi 0" palsu ketika klik/hasilnya memang nol, bukan makin efisien
        if (k === 'cpc' && (!now.clicks || !prev.clicks)) return;
        if (k === 'cpa' && (!now.results || !prev.results)) return;
        var nowV = now[k], prevV = prev[k];
        if (!prevV) return; // tak ada pembanding periode lalu
        var change = ((nowV - prevV) / prevV) * 100;
        if (!change) return;
        rows.push({ channel: c.label, metric: HL_METRICS[k], k: k, now: nowV, change: change, good: change * metricGoodDir(k) > 0 });
      });
    });
    var byMag = function (a, b) { return Math.abs(b.change) - Math.abs(a.change); };
    return {
      good: rows.filter(function (r) { return r.good; }).sort(byMag).slice(0, 4),
      watch: rows.filter(function (r) { return !r.good; }).sort(byMag).slice(0, 4)
    };
  }
  function highlightRowsHtml(list, dec) {
    if (!list.length) return '<p class="hl-empty" style="color:var(--ink-faint);font-size:12.5px;margin:0">Belum ada perubahan berarti dibanding periode lalu.</p>';
    return list.map(function (r) {
      var val = r.k === 'ctr' ? dec(r.now) + '%' : r.k === 'roas' ? dec(r.now, 1) + '×' : rupiah(r.now);
      return '<div class="hl-row"><span class="nm">' + r.channel + ' · ' + r.metric + '</span>' +
        '<span class="vl ' + (r.change >= 0 ? 'up' : 'down') + '">' + (r.change >= 0 ? '↑ +' : '↓ ') +
        Math.round(Math.abs(r.change)) + '% <span class="flat" style="font-weight:400">(' + val + ')</span></span></div>';
    }).join('');
  }

  // ---------- growth signal (gaya "1 hal yang perlu diperhatikan hari ini") ----------
  function growthSignal(ctx) {
    if (ctx.telat.length) {
      return { cls: 'alert', icon: '⏰', title: ctx.telat.length + ' task lewat deadline',
        msg: 'Perlu ditindak: ' + ctx.telat.slice(0, 2).map(function (t) { return esc(t.title); }).join(', ') +
          (ctx.telat.length > 2 ? ', dan lainnya' : '') + '.' };
    }
    if (ctx.spendNow && ctx.revNow) {
      var rasio = (ctx.spendNow / ctx.revNow) * 100;
      if (rasio > 15) {
        return { cls: 'warn', icon: '💸', title: 'Iklan makan ' + Math.round(rasio) + '% dari penjualan',
          msg: 'Cukup tinggi untuk usaha makanan — cek efisiensi tiap channel di halaman Iklan.' };
      }
    }
    if (ctx.kosong > 0) {
      return { cls: 'warn', icon: '📭', title: ctx.kosong + ' hari belum ada data penjualan tercatat',
        msg: 'Rekap periode ini bisa jadi lebih rendah dari kenyataan — lengkapi di halaman Penjualan.' };
    }
    if (ctx.revPct !== null && ctx.revPct <= -10) {
      return { cls: 'alert', icon: '📉', title: 'Penjualan turun ' + Math.abs(ctx.revPct) + '%',
        msg: 'Dibanding periode lalu (' + rupiah(ctx.revPrev) + ') — cek promo atau operasional cabang.' };
    }
    if (ctx.revPct !== null && ctx.revPct >= 10) {
      return { cls: 'good', icon: '📈', title: 'Penjualan naik ' + ctx.revPct + '%',
        msg: 'Dibanding periode lalu (' + rupiah(ctx.revPrev) + ') — pertahankan pola yang sedang berjalan.' };
    }
    return { cls: 'good', icon: '🙂', title: 'Tidak ada yang mendesak',
      msg: 'Penjualan dan task berjalan normal di periode ini.' };
  }

  // ---------- target vs realisasi ----------
  // Bentuk target mengikuti cara Crackling menetapkannya:
  //   Dine-in (ESB) dipecah per cabang; Gojek/Grab dan Paper targetnya total.
  var TARGET_ROWS = [
    { key: 'esb|gading_serpong', source: 'esb', branch: 'gading_serpong', label: 'Dine-in — Gading Serpong', color: '#c1440e' },
    { key: 'esb|kelapa_gading', source: 'esb', branch: 'kelapa_gading', label: 'Dine-in — Kelapa Gading', color: '#d99208' },
    { key: 'gojek_grab|semua', source: 'gojek_grab', branch: 'semua', label: 'Gojek / Grab', color: '#4f7a36' },
    { key: 'paper|semua', source: 'paper', branch: 'semua', label: 'Paper', color: '#2f6fb5' }
  ];

  // Realisasi untuk satu baris target, dijumlahkan dari data penjualan.
  function realisasiTarget(row, dates, sales) {
    return dates.reduce(function (a, d) {
      if (row.branch === 'semua') {
        return a + BRANCHES.reduce(function (s, b) { return s + sales[d][b.key][row.source]; }, 0);
      }
      return a + sales[d][row.branch][row.source];
    }, 0);
  }

  // Target dipasang per bulan, jadi kartunya mengikuti bulan tempat tanggal
  // akhir rentang berada — pilih "bulan lalu", yang tampil target bulan lalu.
  async function renderTarget() {
    var box = document.getElementById('target-box');
    if (!box || !perm.money) return;

    var akhir = new Date(dTo + 'T00:00:00');
    var y = akhir.getFullYear(), m = akhir.getMonth();
    var mk = dTo.slice(0, 7);
    var awalBulan = dateStr(new Date(y, m, 1));
    var akhirBulan = dateStr(new Date(y, m + 1, 0));
    var jmlHari = new Date(y, m + 1, 0).getDate();
    var hariBulan = datesBetween(awalBulan, akhirBulan);

    var target = await DB.getTargets(mk);
    var sales = await DB.getSales(hariBulan);

    var baris = TARGET_ROWS.map(function (r) {
      var t = target[r.key] || 0;
      var real = realisasiTarget(r, hariBulan, sales);
      return { row: r, target: t, real: real, pct: t ? Math.round((real / t) * 100) : 0 };
    });

    var totTarget = baris.reduce(function (a, x) { return a + x.target; }, 0);
    var totReal = baris.reduce(function (a, x) { return a + x.real; }, 0);

    // hari yang sudah berjalan di bulan itu — kalau bulan lampau, seluruhnya
    var hariLewat = (dateStr() > akhirBulan) ? jmlHari
      : (dateStr() < awalBulan ? 0 : new Date().getDate());
    var sisaHari = Math.max(0, jmlHari - hariLewat);

    document.getElementById('target-month').textContent = monthName(y, m);

    if (!totTarget) {
      box.innerHTML = '<p class="sub" style="margin:0">Target bulan ' + monthName(y, m) +
        ' belum diisi. Isi di halaman Penjualan supaya dashboard bisa menghitung progres dan sisa kejaran per hari.</p>';
    } else {
      var pctAll = Math.round((totReal / totTarget) * 100);
      var kurang = totTarget - totReal;
      var perHari = sisaHari ? kurang / sisaHari : 0;
      var laju = hariLewat ? totReal / hariLewat : 0;
      var proyeksi = Math.round(laju * jmlHari);
      var onTrack = proyeksi >= totTarget;

      box.innerHTML =
        '<div class="split" style="margin-bottom:16px">' +
          '<div class="tile"><div class="label">Target bulan ini</div><div class="value num">' + rupiah(totTarget) + '</div>' +
            '<div class="hint">gabungan semua sumber</div></div>' +
          '<div class="tile"><div class="label">Tercapai</div><div class="value num">' + rupiah(totReal) + '</div>' +
            '<div class="hint ' + (pctAll >= 100 ? 'up' : '') + '">' + pctAll + '% dari target</div></div>' +
          '<div class="tile' + (kurang > 0 ? '' : ' accent') + '"><div class="label">' +
            (kurang > 0 ? 'Kurang' : 'Kelebihan') + '</div><div class="value num">' + rupiah(Math.abs(kurang)) + '</div>' +
            '<div class="hint">' + (sisaHari ? 'sisa ' + sisaHari + ' hari' : 'bulan sudah selesai') + '</div></div>' +
          '<div class="tile' + (onTrack ? ' accent' : ' warn') + '"><div class="label">Proyeksi akhir bulan</div>' +
            '<div class="value num">' + rupiah(proyeksi) + '</div>' +
            '<div class="hint ' + (onTrack ? 'up' : 'down') + '">' + (onTrack ? 'di jalur yang benar' : 'berisiko meleset') + '</div></div>' +
        '</div>' +
        '<div class="progress" aria-hidden="true"><div class="fill" style="width:' + Math.min(100, pctAll) +
          '%;background:' + (pctAll >= 100 ? 'var(--herb)' : 'var(--kriuk)') + '"></div></div>' +
        '<p class="sub" style="margin-top:10px">' +
          (kurang <= 0
            ? 'Target bulan ini sudah tercapai, lebih ' + rupiah(-kurang) + '.'
            : (sisaHari
                ? 'Perlu <strong>' + rupiah(Math.round(perHari)) + ' per hari</strong> selama ' + sisaHari +
                  ' hari tersisa. Laju sekarang <strong>' + rupiah(Math.round(laju)) + '/hari</strong>.'
                : 'Bulan sudah berakhir dengan kekurangan ' + rupiah(kurang) + '.')) +
        '</p>' +
        '<p class="group-label">Per sumber</p>' +
        '<div class="brk">' + baris.map(function (x) {
          var sisaIni = x.target - x.real;
          return '<div class="r">' +
            '<span class="swatch" style="background:' + x.row.color + '"></span>' +
            '<span class="nm">' + x.row.label + (x.target ? '' : ' <span class="flat">(belum ada target)</span>') + '</span>' +
            '<span class="vl">' + rupiahShort(x.real) + (x.target ? ' / ' + rupiahShort(x.target) : '') + '</span>' +
            '<span class="pc ' + (x.pct >= 100 ? 'up' : '') + '">' + (x.target ? x.pct + '%' : '–') + '</span>' +
            '<span class="bar"><i style="width:' + Math.min(100, x.pct) + '%;background:' +
              (x.pct >= 100 ? 'var(--herb)' : x.row.color) + '"></i></span>' +
            (x.target && sisaIni > 0 && sisaHari
              ? '<span class="pc flat" style="grid-column:2/-1;text-align:left;width:auto;font-size:11.5px">kurang ' +
                rupiahShort(sisaIni) + ' · butuh ' + rupiahShort(Math.round(sisaIni / sisaHari)) + '/hari</span>'
              : '') +
            '</div>';
        }).join('') + '</div>';
    }

    // isi form dengan target yang sedang berlaku
    TARGET_ROWS.forEach(function (r) {
      var inp = document.getElementById('tg-' + r.source + '-' + r.branch);
      if (inp) inp.value = target[r.key] || '';
    });
    var lab = document.getElementById('tg-month-label');
    if (lab) lab.textContent = monthName(y, m);
  }

  function wireTarget() {
    if (!document.getElementById('target-form')) return;
    onSubmit('target-form', async function () {
      var mk = dTo.slice(0, 7);
      for (var i = 0; i < TARGET_ROWS.length; i++) {
        var r = TARGET_ROWS[i];
        var v = Number(document.getElementById('tg-' + r.source + '-' + r.branch).value) || 0;
        var res = await DB.saveTarget(mk, r.source, r.branch, v);
        if (res && res.error) { say('target-saved', 'Gagal: ' + res.error.message); return; }
      }
      say('target-saved', 'Target tersimpan');
      renderTarget();
    });
  }

  async function renderRecap(cur, prev, sales, ads, notes) {
    var akhir = cur[cur.length - 1];
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

    document.getElementById('recap-period').textContent = labelPeriode();

    // ---------- KPI utama ----------
    var chip = function (p) {
      if (p === null) return '<div class="hint">belum ada pembanding</div>';
      return '<div class="hint ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '↑ +' : '↓ ') + p + '% vs periode lalu</div>';
    };
    var tasks = await DB.getTasks();
    var inPeriod = tasks.filter(function (t) { return t.deadline >= cur[0] && t.deadline <= akhir; });
    var doneCount = inPeriod.filter(function (t) { return t.status === 'done'; }).length;
    var taskPct = inPeriod.length ? Math.round((doneCount / inPeriod.length) * 100) : 0;
    var telat = tasks.filter(function (t) { return t.status !== 'done' && t.deadline < dateStr(); });

    document.getElementById('recap-kpi').innerHTML =
      '<div class="tile"><div class="label">Penjualan</div><div class="value num">' + rupiah(revNow) + '</div>' + chip(revPct) + '</div>' +
      '<div class="tile"><div class="label">Biaya iklan</div><div class="value num">' + rupiah(spendNow) + '</div>' + chip(spendPct) + '</div>' +
      '<div class="tile accent"><div class="label">ROAS blended</div><div class="value num">' +
        (spendNow ? roas.toFixed(1).replace('.', ',') + '×' : '—') + '</div>' +
        '<div class="hint">' + (spendNow ? 'tiap Rp1 iklan → ' + rupiah(roas) : 'belum ada biaya iklan') + '</div></div>' +
      '<div class="tile"><div class="label">Rasio iklan</div><div class="value num">' +
        (revNow ? ((spendNow / revNow) * 100).toFixed(1).replace('.', ',') + '%' : '—') + '</div>' +
        '<div class="hint">porsi iklan dari penjualan</div></div>' +
      '<div class="tile"><div class="label">Rata-rata harian</div><div class="value num">' + rupiah(Math.round(revNow / range)) + '</div>' +
        '<div class="hint">penjualan per hari</div></div>' +
      '<div class="tile' + (telat.length ? ' warn' : '') + '"><div class="label">Task lewat deadline</div><div class="value num">' + telat.length + '</div>' +
        '<div class="hint">' + (telat.length ? 'perlu ditindak' : 'aman') + '</div></div>';

    // ---------- kartu PENJUALAN ----------
    document.getElementById('ov-sales-sub').textContent = labelPeriode();
    document.getElementById('ov-sales-total').textContent = rupiah(revNow);
    document.getElementById('ov-sales-delta').innerHTML = deltaHtml(revNow, revPrev) +
      (revPrev ? ' <span class="flat">(' + rupiah(revPrev) + ')</span>' : '');

    var srcTot = SOURCES.map(function (s) {
      return {
        label: s.label, color: s.color,
        v: cur.reduce(function (sum, d) {
          return sum + BRANCHES.reduce(function (a, b) { return a + sales[d][b.key][s.key]; }, 0);
        }, 0)
      };
    }).sort(function (a, b) { return b.v - a.v; });
    document.getElementById('ov-sales-src').innerHTML = brkWrap(
      srcTot.filter(function (s) { return s.v; })
        .map(function (s) { return brkRow(s.label, s.color, s.v, revNow, rupiah); }).join('')
    );

    var brTot = BRANCHES.map(function (b) {
      return {
        label: b.label, color: b.color,
        v: cur.reduce(function (s, d) { return s + branchTotal(sales[d][b.key]); }, 0)
      };
    }).sort(function (a, b) { return b.v - a.v; });
    document.getElementById('ov-sales-branch').innerHTML = brkWrap(
      brTot.filter(function (b) { return b.v; })
        .map(function (b) { return brkRow(b.label, b.color, b.v, revNow, rupiah); }).join('')
    );

    // ---------- kartu IKLAN ----------
    document.getElementById('ov-ads-sub').textContent = labelPeriode();
    document.getElementById('ov-ads-total').textContent = rupiah(spendNow);
    document.getElementById('ov-ads-delta').innerHTML = deltaHtml(spendNow, spendPrev) +
      (spendPrev ? ' <span class="flat">(' + rupiah(spendPrev) + ')</span>' : '');

    var chTot = CHANNELS.map(function (c) {
      return { label: c.label, color: c.color, v: cur.reduce(function (a, d) { return a + ads[d][c.key].spend; }, 0) };
    }).sort(function (a, b) { return b.v - a.v; });
    document.getElementById('ov-ads-src').innerHTML = brkWrap(
      chTot.filter(function (c) { return c.v; })
        .map(function (c) { return brkRow(c.label, c.color, c.v, spendNow, rupiah); }).join('')
    );

    var dec = function (n, d) { return (Number(n) || 0).toFixed(d === undefined ? 2 : d).replace('.', ','); };
    document.getElementById('ov-ads-perf').innerHTML = spendNow
      ? '<div class="split">' +
          '<div class="tile"><div class="label">Impresi</div><div class="value num">' + adTotals.impressions.toLocaleString('id-ID') + '</div></div>' +
          '<div class="tile"><div class="label">Klik</div><div class="value num">' + adTotals.clicks.toLocaleString('id-ID') + '</div>' +
            '<div class="hint">CTR ' + (adTotals.ctr ? dec(adTotals.ctr) + '%' : '—') + '</div></div>' +
          '<div class="tile"><div class="label">CPC</div><div class="value num">' + (adTotals.cpc ? rupiah(adTotals.cpc) : '—') + '</div>' +
            '<div class="hint">CPM ' + (adTotals.cpm ? rupiah(adTotals.cpm) : '—') + '</div></div>' +
          '<div class="tile"><div class="label">Hasil</div><div class="value num">' + adTotals.results.toLocaleString('id-ID') + '</div>' +
            '<div class="hint">' + (adTotals.cpa ? rupiah(adTotals.cpa) + ' per hasil' : 'belum ada konversi') + '</div></div>' +
        '</div>'
      : '<span class="none" style="color:var(--ink-faint);font-size:13px">Tidak ada belanja iklan di periode ini.</span>';

    // ---------- kartu SOCIAL MEDIA ----------
    var social = await DB.getSocialHistory(200);
    var dalam = social.filter(function (s) { return s.entry_date >= cur[0] && s.entry_date <= akhir; });
    var latest = dalam[dalam.length - 1] || social[social.length - 1];
    var base = null;
    for (var i = social.length - 1; i >= 0; i--) {
      if (social[i].entry_date < cur[0]) { base = social[i]; break; }
    }
    if (!base) base = dalam[0] || social[0];

    var totNow = latest ? PLATFORMS.reduce(function (a, p) { return a + (Number(latest[p.key]) || 0); }, 0) : 0;
    var totBase = base ? PLATFORMS.reduce(function (a, p) { return a + (Number(base[p.key]) || 0); }, 0) : 0;
    document.getElementById('ov-soc-sub').textContent = latest
      ? 'Dicatat terakhir ' + longDate(latest.entry_date) : 'Belum ada data';
    document.getElementById('ov-soc-total').textContent = totNow.toLocaleString('id-ID');
    document.getElementById('ov-soc-delta').innerHTML = latest && base && base !== latest
      ? (function () {
          var d = totNow - totBase;
          return '<span class="' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '') + d.toLocaleString('id-ID') + ' follower</span>' +
            ' <span class="flat">sejak ' + shortLabel(base.entry_date) + '</span>';
        })()
      : '<span class="flat">total follower semua platform</span>';

    document.getElementById('ov-soc-src').innerHTML = brkWrap(
      latest ? PLATFORMS.map(function (p) {
        var n = Number(latest[p.key]) || 0;
        var w = base ? Number(base[p.key]) || 0 : 0;
        var d = n - w;
        var pp = w ? Math.round((d / w) * 1000) / 10 : null;
        var share = totNow ? Math.round((n / totNow) * 100) : 0;
        return '<div class="r">' +
          '<span class="swatch" style="background:' + p.line + '"></span>' +
          '<span class="nm">' + p.label + '</span>' +
          '<span class="vl">' + n.toLocaleString('id-ID') + '</span>' +
          '<span class="pc ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' +
            (d ? (d > 0 ? '+' : '') + d.toLocaleString('id-ID') : '–') + '</span>' +
          '<span class="bar"><i style="width:' + share + '%;background:' + p.line + '"></i></span>' +
          (pp !== null && d ? '<span class="pc ' + (d > 0 ? 'up' : 'down') + '" style="grid-column:3/-1;text-align:left;width:auto">' +
            (pp > 0 ? '+' : '') + String(pp).replace('.', ',') + '% pertumbuhan</span>' : '') +
          '</div>';
      }).join('') : ''
    );

    // ---------- kartu TASK ----------
    var anggota = await DB.getMembers();
    var namaOf = {};
    anggota.forEach(function (m) { namaOf[m.id] = m.name; });
    document.getElementById('ov-task-sub').textContent = inPeriod.length
      ? inPeriod.length + ' task dengan deadline di periode ini' : 'Belum ada task di periode ini';
    document.getElementById('ov-task-total').textContent = (inPeriod.length ? taskPct : 0) + '%';
    document.getElementById('ov-task-delta').innerHTML = inPeriod.length
      ? '<span class="' + (taskPct >= 70 ? 'up' : 'down') + '">' + doneCount + ' dari ' + inPeriod.length + ' selesai</span>' +
        (telat.length ? ' <span class="down">· ' + telat.length + ' lewat deadline</span>' : '')
      : '<span class="flat">belum ada task berdeadline di periode ini</span>';

    var perOrang = {};
    inPeriod.forEach(function (t) {
      var k = t.assignee_id || 'lain';
      if (!perOrang[k]) perOrang[k] = { total: 0, done: 0 };
      perOrang[k].total++;
      if (t.status === 'done') perOrang[k].done++;
    });
    var keys = Object.keys(perOrang).sort(function (a, b) { return perOrang[b].total - perOrang[a].total; });
    document.getElementById('ov-task-src').innerHTML = brkWrap(
      keys.map(function (k) {
        var o = perOrang[k];
        var p = Math.round((o.done / o.total) * 100);
        return '<div class="r">' +
          '<span class="swatch" style="background:' + (p >= 70 ? '#4f7a36' : '#d99208') + '"></span>' +
          '<span class="nm">' + esc(namaOf[k] || 'Belum ada PIC') + '</span>' +
          '<span class="vl">' + o.done + '/' + o.total + '</span>' +
          '<span class="pc">' + p + '%</span>' +
          '<span class="bar"><i style="width:' + p + '%;background:' + (p >= 70 ? '#4f7a36' : '#d99208') + '"></i></span>' +
          '</div>';
      }).join('')
    );

    // ---------- catatan penting ----------
    var ins = [];
    var harian = cur.map(function (d) { return { d: d, v: dayTotal(sales[d]) }; }).filter(function (x) { return x.v > 0; });
    var best = harian.slice().sort(function (a, b) { return b.v - a.v; })[0];
    var worst = harian.slice().sort(function (a, b) { return a.v - b.v; })[0];
    if (best) {
      ins.push('<span class="ic">📈</span><span>Penjualan tertinggi <b>' + dayInitial(best.d) + ', ' + longDate(best.d) +
        '</b> sebesar <b>' + rupiah(best.v) + '</b>' +
        (worst && worst.d !== best.d ? ', terendah ' + dayInitial(worst.d) + ' ' + shortLabel(worst.d) + ' (' + rupiah(worst.v) + ')' : '') + '</span>');
    }
    if (brTot[0] && brTot[0].v && brTot[1]) {
      var selisih = brTot[0].v - brTot[1].v;
      ins.push('<span class="ic">🏪</span><span><b>' + brTot[0].label + '</b> memimpin dengan selisih <b>' +
        rupiah(selisih) + '</b> dari ' + brTot[1].label + '</span>');
    }
    if (srcTot[0] && srcTot[0].v) {
      ins.push('<span class="ic">🧾</span><span>Sumber penjualan terbesar <b>' + srcTot[0].label + '</b> — ' +
        Math.round((srcTot[0].v / revNow) * 100) + '% dari total</span>');
    }
    if (!spendNow) {
      ins.push('<span class="ic">📣</span><span>Tidak ada belanja iklan di periode ini, jadi ROAS dan CPC belum bisa dinilai</span>');
    } else if (revNow) {
      var rasio = (spendNow / revNow) * 100;
      ins.push('<span class="ic">💸</span><span>Iklan memakan <b>' + dec(rasio, 1) + '%</b> dari penjualan' +
        (rasio > 15 ? ' — cukup tinggi untuk usaha makanan, perlu dicek efisiensinya' : ' — masih dalam batas wajar') + '</span>');
    }
    var promoHari = cur.filter(function (d) { return notes[d]; });
    if (promoHari.length) {
      ins.push('<span class="ic">🎉</span><span><b>' + promoHari.length + ' hari</b> ada promo berjalan: ' +
        promoHari.slice(0, 3).map(function (d) { return esc(notes[d]) + ' (' + shortLabel(d) + ')'; }).join(', ') +
        (promoHari.length > 3 ? ', dan lainnya' : '') + '</span>');
    }
    if (telat.length) {
      ins.push('<span class="ic">⏰</span><span><b>' + telat.length + ' task</b> sudah lewat deadline dan belum selesai: ' +
        telat.slice(0, 3).map(function (t) { return esc(t.title); }).join(', ') +
        (telat.length > 3 ? ', dan lainnya' : '') + '</span>');
    }
    var kosong = cur.filter(function (d) { return !dayTotal(sales[d]); }).length;
    if (kosong) {
      ins.push('<span class="ic">📭</span><span><b>' + kosong + ' hari</b> belum ada data penjualan tercatat di periode ini — angkanya bisa jadi lebih rendah dari kenyataan</span>');
    }
    document.getElementById('ov-insights').innerHTML = ins.length
      ? ins.map(function (x) { return '<li>' + x + '</li>'; }).join('')
      : '<li><span class="ic">🙂</span><span>Belum ada cukup data untuk disimpulkan di periode ini.</span></li>';

    // ---------- growth signal: satu hal terpenting untuk dilihat lebih dulu ----------
    var gs = growthSignal({ revNow: revNow, revPrev: revPrev, revPct: revPct, spendNow: spendNow, kosong: kosong, telat: telat });
    var gsEl = document.getElementById('growth-signal');
    gsEl.className = 'growth ' + gs.cls;
    gsEl.innerHTML = '<span class="gi" aria-hidden="true">' + gs.icon + '</span><span><b>' + gs.title + '</b><p>' + gs.msg + '</p></span>';

    // ---------- teks rekap untuk WhatsApp ----------
    var L = [];
    L.push('*Rekap Crackling — ' + longDate(cur[0]) + ' s/d ' + longDate(akhir) + '*', '');
    L.push('*PENJUALAN*');
    L.push('Total: ' + rupiah(revNow) + (revPct !== null ? ' (' + (revPct >= 0 ? '+' : '') + revPct + '% vs periode lalu)' : ''));
    L.push('Rata-rata harian: ' + rupiah(Math.round(revNow / range)));
    brTot.forEach(function (b) { if (b.v) L.push('• ' + b.label + ': ' + rupiah(b.v) + ' (' + Math.round((b.v / revNow) * 100) + '%)'); });
    srcTot.forEach(function (s) { if (s.v) L.push('• ' + s.label + ': ' + rupiah(s.v) + ' (' + Math.round((s.v / revNow) * 100) + '%)'); });
    if (best) L.push('Hari terbaik: ' + dayInitial(best.d) + ' ' + shortLabel(best.d) + ' — ' + rupiah(best.v));
    L.push('', '*IKLAN*');
    L.push('Total biaya: ' + rupiah(spendNow) + (spendPct !== null ? ' (' + (spendPct >= 0 ? '+' : '') + spendPct + '%)' : ''));
    chTot.forEach(function (c) { if (c.v) L.push('• ' + c.label + ': ' + rupiah(c.v) + ' (' + Math.round((c.v / spendNow) * 100) + '%)'); });
    if (adTotals.impressions || adTotals.clicks) {
      L.push('Impresi ' + adTotals.impressions.toLocaleString('id-ID') + ' · Klik ' + adTotals.clicks.toLocaleString('id-ID') +
        (adTotals.ctr ? ' · CTR ' + dec(adTotals.ctr) + '%' : ''));
      L.push('CPC ' + (adTotals.cpc ? rupiah(adTotals.cpc) : '—') + ' · CPM ' + (adTotals.cpm ? rupiah(adTotals.cpm) : '—'));
    }
    if (adTotals.results) L.push('Hasil ' + adTotals.results.toLocaleString('id-ID') + ' · Biaya per hasil ' + rupiah(adTotals.cpa));
    if (spendNow) {
      L.push('ROAS platform: ' + (adTotals.roas ? dec(adTotals.roas, 1) + '×' : '—') +
        ' · ROAS blended: ' + dec(roas, 1) + '×' +
        (revNow ? ' · rasio iklan ' + dec((spendNow / revNow) * 100, 1) + '%' : ''));
    }
    if (promoHari.length) {
      L.push('Promo:');
      promoHari.forEach(function (d) { L.push('• ' + notes[d] + ' (' + shortLabel(d) + ')'); });
    }
    L.push('', '*SOCIAL MEDIA*');
    if (latest) {
      PLATFORMS.forEach(function (p) {
        var n = Number(latest[p.key]) || 0, w = base ? Number(base[p.key]) || 0 : 0, d = n - w;
        L.push('• ' + p.label + ': ' + n.toLocaleString('id-ID') + (d ? ' (' + (d > 0 ? '+' : '') + d.toLocaleString('id-ID') + ')' : ''));
      });
      L.push('Total follower: ' + totNow.toLocaleString('id-ID'));
    } else L.push('Belum ada data.');
    L.push('', '*TASK TIM*');
    L.push(inPeriod.length ? 'Selesai ' + doneCount + ' dari ' + inPeriod.length + ' task (' + taskPct + '%)' : 'Belum ada task berdeadline di periode ini.');
    keys.forEach(function (k) {
      L.push('• ' + (namaOf[k] || 'Tanpa PIC') + ': ' + perOrang[k].done + '/' + perOrang[k].total);
    });
    if (telat.length) L.push('Lewat deadline: ' + telat.length + ' task');
    recapText = L.join('\n');
  }


  // ---------- task ----------
  var calY, calM, selectedDate = dateStr();
  var taskView = 'semua';          // semua | saya | diberikan
  var members = [];                // daftar rekan setim
  var nameOf = {};                 // id -> nama

  var STATUS_LABEL = { todo: 'Belum dikerjakan', progress: 'Sedang jalan', done: 'Selesai' };

  function taskFilter(list) {
    if (taskView === 'saya') return list.filter(function (t) { return t.assignee_id === me.id; });
    if (taskView === 'diberikan') return list.filter(function (t) { return t.created_by === me.id; });
    return list;
  }

  function taskHtml(t, showDate) {
    var telat = t.status !== 'done' && t.deadline < dateStr();
    var pic = nameOf[t.assignee_id] || 'Belum ada PIC';
    var dari = nameOf[t.created_by] || '—';
    // PIC dan pemberi tugas boleh mengubah status; penghapusan hanya untuk pemberi/owner/lead
    var bolehHapus = t.created_by === me.id || perm.money;
    return '<li class="' + (t.status === 'done' ? 'done' : '') + '">' +
      '<span class="body">' +
        '<span class="t">' + esc(t.title) + '</span>' +
        (t.detail ? '<span class="m">' + esc(t.detail) + '</span>' : '') +
        '<span class="meta-row">' +
          '<select class="stat" data-status="' + t.id + '" aria-label="Status task">' +
            ['todo', 'progress', 'done'].map(function (s) {
              return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>';
            }).join('') +
          '</select>' +
          '<span class="chip pic">PIC: ' + esc(pic) + '</span>' +
          '<span class="chip from">dari ' + esc(dari) + '</span>' +
          '<span class="chip ' + t.scope + '">' + (t.scope === 'panjang' ? 'jangka panjang' : 'jangka pendek') + '</span>' +
          (showDate ? '<span class="chip ' + (telat ? 'late' : 'todo') + '">deadline ' + longDate(t.deadline) + '</span>'
                    : (telat ? '<span class="chip late">lewat deadline</span>' : '')) +
        '</span>' +
      '</span>' +
      (bolehHapus ? '<button class="del" data-deltask="' + t.id + '" aria-label="Hapus task: ' + esc(t.title) + '" title="Hapus">&times;</button>' : '') +
      '</li>';
  }

  function wireTaskList(el) {
    el.querySelectorAll('[data-status]').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        await DB.setTaskStatus(sel.getAttribute('data-status'), sel.value);
        renderWork();
        refresh();
      });
    });
    el.querySelectorAll('[data-deltask]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Hapus task ini? Tidak bisa dibatalkan.')) return;
        await DB.deleteTask(btn.getAttribute('data-deltask'));
        renderWork();
        refresh();
      });
    });
  }

  async function renderWork() {
    var all = await DB.getTasks();
    var tasks = taskFilter(all);
    var today = dateStr();

    if (!members.length) {
      members = await DB.getMembers();
      members.forEach(function (m) { nameOf[m.id] = m.name; });
      var sel = document.getElementById('w-assignee');
      sel.innerHTML = members.map(function (m) {
        return '<option value="' + m.id + '"' + (m.id === me.id ? ' selected' : '') + '>' +
          esc(m.name) + ' — ' + (ROLE_LABEL[m.role] || m.role) + '</option>';
      }).join('');
    }

    // statistik
    var weekEnd = shiftDays(6);
    var mingguIni = tasks.filter(function (t) { return t.deadline >= today && t.deadline <= weekEnd && t.status !== 'done'; });
    var telat = tasks.filter(function (t) { return t.status !== 'done' && t.deadline < today; });
    var jalan = tasks.filter(function (t) { return t.status === 'progress'; });
    var panjang = tasks.filter(function (t) { return t.scope === 'panjang' && t.status !== 'done'; });

    document.getElementById('work-stats').innerHTML =
      '<div class="tile"><div class="label">Deadline 7 hari ke depan</div><div class="value num">' + mingguIni.length + '</div><div class="hint">belum selesai</div></div>' +
      '<div class="tile"><div class="label">Sedang dikerjakan</div><div class="value num">' + jalan.length + '</div><div class="hint">status sedang jalan</div></div>' +
      '<div class="tile' + (telat.length ? ' warn' : '') + '"><div class="label">Lewat deadline</div><div class="value num">' + telat.length + '</div><div class="hint">' + (telat.length ? 'perlu ditindak' : 'aman') + '</div></div>' +
      '<div class="tile"><div class="label">Jangka panjang</div><div class="value num">' + panjang.length + '</div><div class="hint">masih berjalan</div></div>';

    // kalender berdasarkan deadline
    if (calY === undefined) { var n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); }
    document.getElementById('cal-month').textContent = monthName(calY, calM);
    document.getElementById('cal-dow').innerHTML = DOW.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');

    var first = new Date(calY, calM, 1);
    var offset = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(calY, calM + 1, 0).getDate();
    var cells = '';
    for (var b = 0; b < offset; b++) cells += '<div class="cal-cell blank"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = dateStr(new Date(calY, calM, day));
      var items = tasks.filter(function (t) { return t.deadline === ds; });
      var dots = items.slice(0, 4).map(function (t) {
        var kelas = t.status === 'done' ? 'done'
          : (t.deadline < today ? 'late' : (t.status === 'progress' ? 'progress' : ''));
        return '<span class="dot ' + kelas + '"></span>';
      }).join('');
      cells += '<button type="button" class="cal-cell' + (ds === today ? ' today' : '') + '" data-day="' + ds + '"' +
        ' aria-pressed="' + (ds === selectedDate) + '" aria-label="' + longDate(ds) + ', ' + items.length + ' task">' +
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
        document.getElementById('w-deadline').value = selectedDate;
        renderWork();
      });
    });

    // task pada tanggal terpilih
    document.getElementById('work-day-title').textContent = 'Task deadline ' + longDate(selectedDate);
    var dayItems = tasks.filter(function (t) { return t.deadline === selectedDate; });
    document.getElementById('work-day-sub').textContent = dayItems.length
      ? dayItems.filter(function (t) { return t.status === 'done'; }).length + ' dari ' + dayItems.length + ' selesai'
      : 'Tidak ada task dengan deadline tanggal ini';
    var list = document.getElementById('work-list');
    list.innerHTML = dayItems.length
      ? dayItems.map(function (t) { return taskHtml(t, false); }).join('')
      : '<li><span class="empty">Kosong. Buat task baru lewat form di atas.</span></li>';
    wireTaskList(list);

    var lateEl = document.getElementById('work-late');
    lateEl.innerHTML = telat.length
      ? telat.map(function (t) { return taskHtml(t, true); }).join('')
      : '<li><span class="empty">Tidak ada yang lewat deadline. Aman.</span></li>';
    wireTaskList(lateEl);

    var longEl = document.getElementById('work-long');
    longEl.innerHTML = panjang.length
      ? panjang.map(function (t) { return taskHtml(t, true); }).join('')
      : '<li><span class="empty">Belum ada rencana jangka panjang.</span></li>';
    wireTaskList(longEl);
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
    document.getElementById('w-deadline').value = selectedDate;

    document.querySelectorAll('[data-taskview]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        taskView = btn.getAttribute('data-taskview');
        document.querySelectorAll('[data-taskview]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        renderWork();
      });
    });

    onSubmit('work-form', async function () {
      var input = document.getElementById('w-title');
      var title = input.value.trim();
      var deadline = document.getElementById('w-deadline').value;
      if (!title || !deadline) return;
      var res = await DB.addTask({
        title: title,
        detail: document.getElementById('w-detail').value.trim(),
        assignee_id: document.getElementById('w-assignee').value,
        deadline: deadline,
        scope: document.getElementById('w-scope').value
      });
      if (res && res.error) { say('work-saved', 'Gagal: ' + res.error.message); return; }
      input.value = '';
      document.getElementById('w-detail').value = '';
      var pic = document.getElementById('w-assignee');
      say('work-saved', 'Task untuk ' + pic.options[pic.selectedIndex].text.split(' — ')[0] +
        ', deadline ' + longDate(deadline));
      selectedDate = deadline;
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

    document.getElementById('copy-ads').addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(adsRecapText);
      } catch (e) {
        var ta = document.createElement('textarea');
        ta.value = adsRecapText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      say('ads-recap-saved', 'Performa iklan tersalin — tinggal paste ke grup');
    });

    wireDateRange();
    fillAdsForm();
    fillNoteForm();
  }

  // ---------- pemilih rentang tanggal ----------
  function setRange(from, to) {
    if (from > to) { var t = from; from = to; to = t; }
    dFrom = from;
    dTo = to;
    range = daysBetween(dFrom, dTo);
    document.getElementById('dr-from').value = dFrom;
    document.getElementById('dr-to').value = dTo;
    refresh();
  }

  function presetRange(kode) {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    if (kode === 'bulan-ini') return [dateStr(new Date(y, m, 1)), dateStr(new Date(y, m + 1, 0))];
    if (kode === 'bulan-lalu') return [dateStr(new Date(y, m - 1, 1)), dateStr(new Date(y, m, 0))];
    if (kode === 'tahun-ini') return [dateStr(new Date(y, 0, 1)), dateStr(new Date(y, 11, 31))];
    if (kode === 'tahun-lalu') return [dateStr(new Date(y - 1, 0, 1)), dateStr(new Date(y - 1, 11, 31))];
    return [shiftDays(-(Number(kode) - 1)), dateStr()];   // 7 / 30 / 90 hari terakhir
  }

  function wireDateRange() {
    document.getElementById('dr-from').value = dFrom;
    document.getElementById('dr-to').value = dTo;

    document.getElementById('dr-apply').addEventListener('click', function () {
      var f = document.getElementById('dr-from').value;
      var t = document.getElementById('dr-to').value;
      if (!f || !t) return;
      document.querySelectorAll('[data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      setRange(f, t);
    });

    document.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = presetRange(btn.getAttribute('data-preset'));
        document.querySelectorAll('[data-preset]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        setRange(r[0], r[1]);
      });
    });

    var def = document.querySelector('[data-preset="30"]');
    if (def) def.setAttribute('aria-pressed', 'true');
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
    wireTarget();
    // di-await supaya kegagalan render ikut tertangkap try/catch di boot(),
    // bukan jadi unhandled rejection yang tidak terlihat siapa pun
    if (perm.money) await renderNumbers();
    else await renderAdsOnly();
    if (perm.social) await renderSocial();
    await renderWork();
  }

  // Peran tanpa akses penjualan: tetap butuh angka iklan, tapi tanpa data omzet.
  async function renderAdsOnly() {
    if (!perm.ads) return;
    var p = periode();
    var cur = p.cur, prev = p.prev;
    var dates = prev.concat(cur);
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

  // session boleh dioper langsung dari hasil login; kalau tidak, baru diambil ulang.
  // firstLoad = pembukaan halaman biasa (belum tentu sudah login), jadi layar
  // login ditampilkan polos tanpa pesan error.
  async function boot(session, firstLoad) {
    if (!session) session = await Auth.session();
    if (!session) {
      if (!firstLoad && !storageBisaDipakai()) {
        showLogin('Browser memblokir penyimpanan sesi, jadi login tidak bisa bertahan. ' +
          'Di Edge: Settings > Privacy > Tracking prevention, set ke Basic, atau tambahkan situs ini ke daftar pengecualian.');
        return;
      }
      showLogin(firstLoad ? '' : 'Login berhasil tapi sesi tidak terbaca. Coba muat ulang halaman (Ctrl+Shift+R).');
      return;
    }

    var res = await Auth.profile(session.user.id);
    if (res.error) {
      showLogin('Gagal membaca profil: ' + res.error.message);
      return;
    }
    if (!res.data) {
      await Auth.signOut();
      showLogin('Akun ini belum diberi peran. Minta owner menjalankan perintah penetapan peran di Supabase.');
      return;
    }
    try {
      await startApp(res.data);
    } catch (e) {
      // Jangan pernah gagal diam-diam — tampilkan sebabnya.
      showLogin('Dashboard gagal dimuat: ' + (e && e.message ? e.message : e));
    }
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
      // pakai sesi hasil login langsung, jangan ambil ulang (ada jeda tulis/baca)
      boot(res.data && res.data.session);
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await Auth.signOut();
      location.reload();
    });

    boot(null, true);
  });
})();
