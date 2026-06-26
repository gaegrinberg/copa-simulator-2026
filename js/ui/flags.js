// Bandeiras das seleções via flagcdn.com (SVG, sem API key).
// Mapeia código FIFA → ISO-2 (com subdivisões GB para ENG/SCO).
// Helper exposto globalmente como Flags.html(code, opts).

(function (global) {
  const ISO = {
    ALG: 'dz', ARG: 'ar', AUS: 'au', AUT: 'at', BEL: 'be', BIH: 'ba', BRA: 'br',
    CAN: 'ca', CIV: 'ci', COD: 'cd', COL: 'co', CPV: 'cv', CRO: 'hr', CUW: 'cw',
    CZE: 'cz', ECU: 'ec', EGY: 'eg', ENG: 'gb-eng', ESP: 'es', FRA: 'fr',
    GER: 'de', GHA: 'gh', HAI: 'ht', IRN: 'ir', IRQ: 'iq', JOR: 'jo',
    JPN: 'jp', KOR: 'kr', KSA: 'sa', MAR: 'ma', MEX: 'mx', NED: 'nl',
    NOR: 'no', NZL: 'nz', PAN: 'pa', PAR: 'py', POR: 'pt', QAT: 'qa',
    RSA: 'za', SCO: 'gb-sct', SEN: 'sn', SUI: 'ch', SWE: 'se', TUN: 'tn',
    TUR: 'tr', URU: 'uy', USA: 'us', UZB: 'uz',
  };

  function url(code) {
    const iso = ISO[code];
    return iso ? `https://flagcdn.com/${iso}.svg` : '';
  }

  // Retorna HTML <img>. opts.size = altura em px (default 14).
  function html(code, opts) {
    opts = opts || {};
    const u = url(code);
    if (!u) return '';
    const h = opts.size || 14;
    const w = Math.round(h * 4 / 3);
    const cls = opts.cls ? ` ${opts.cls}` : '';
    return `<img class="flag${cls}" src="${u}" alt="" loading="lazy" width="${w}" height="${h}">`;
  }

  global.Flags = { url, html, ISO };
})(window);
