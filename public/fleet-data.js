/**
 * FleetTrack single source of truth for fleet data.
 *
 * Pattern:
 *   1. Ships with baked-in demo data so the UI is never empty.
 *   2. Exposes FleetData.load() — an async function that tries to hydrate
 *      the same shape from /api/* endpoints (live Neon data). Returns the
 *      live arrays on success; returns the baked-in arrays on failure.
 *   3. Consumers (dashboard.html, driver.html, auth.js) read from
 *      window.FleetData.drivers / .vehicles / .trips instead of redefining
 *      their own local copies.
 *
 * This kills the cross-file duplication (item 30 in the audit) and sets
 * up the one-line migration from static -> API-fed data:
 *   BEFORE:  const drivers = FleetData.drivers;
 *   AFTER:   const drivers = (await FleetData.load()).drivers;
 */
window.FleetData = (function(){
  // ── Baked-in demo data (stays in sync with auth.js DEMO_USERS) ─────
  // rank, name, carId, brand, shift, revenue/day, rev/hr, trips/hr,
  // acceptance%, cancels, idle%, utilization%, zone, commission%
  const drivers = [
    {r:1,  id:'drv-1',  n:'Olsztynski Mariusz Zbigniew', car:'TR2518', brand:'NIO ET5',       shift:'AM', rev:298,revhr:24.8,triphr:2.6,acc:88,can:4, idle:19,util:74,zone:'City Centre', comm:65},
    {r:2,  id:'drv-2',  n:'Armand Ionut Neculaita',      car:'TR2537', brand:'NIO EL6',       shift:'AM', rev:281,revhr:23.4,triphr:2.5,acc:86,can:4, idle:21,util:72,zone:'City Centre', comm:65},
    {r:3,  id:'drv-3',  n:'Szymon Silay Khassany',       car:'TR2540', brand:'NIO ET5',       shift:'AM', rev:264,revhr:22.0,triphr:2.3,acc:84,can:5, idle:23,util:70,zone:'Airport',     comm:65},
    {r:4,  id:'drv-4',  n:'Piotr Nowak',                 car:'TR732',  brand:'NIO EL6',       shift:'AM', rev:251,revhr:20.9,triphr:2.2,acc:83,can:5, idle:25,util:68,zone:'City Centre', comm:65},
    {r:5,  id:'drv-5',  n:'Faniel Tsegay Weldetnase',    car:'TR2519', brand:'TESLA MODEL Y', shift:'AM', rev:244,revhr:20.3,triphr:2.1,acc:82,can:6, idle:26,util:67,zone:'Airport',     comm:65},
    {r:6,  id:'drv-6',  n:'Aram Khalandy',               car:'TR2520', brand:'NIO ET5',       shift:'AM', rev:238,revhr:19.8,triphr:2.0,acc:81,can:6, idle:28,util:66,zone:'City Centre', comm:65},
    {r:7,  id:'drv-7',  n:'Sofiullah Razai',             car:'TR2539', brand:'NIO ET5',       shift:'AM', rev:231,revhr:19.3,triphr:2.0,acc:80,can:7, idle:29,util:65,zone:'City Centre', comm:65},
    {r:8,  id:'drv-8',  n:'Imran Shinwari',              car:'TR2539', brand:'NIO ET5',       shift:'PM', rev:218,revhr:18.2,triphr:1.9,acc:79,can:7, idle:31,util:63,zone:'City Centre', comm:65},
    {r:9,  id:'drv-9',  n:'Alaa Haithem Alnaeb',         car:'TR2597', brand:'TESLA MODEL 3', shift:'AM', rev:224,revhr:18.7,triphr:1.9,acc:78,can:7, idle:30,util:64,zone:'Business Park',comm:65},
    {r:10, id:'drv-10', n:'Mateusz Kamil Golik',         car:'TR2516', brand:'NIO ET5',       shift:'AM', rev:217,revhr:18.1,triphr:1.8,acc:78,can:8, idle:32,util:62,zone:'City Centre', comm:65},
    {r:11, id:'drv-11', n:'Martin Pastor',               car:'TR2516', brand:'NIO ET5',       shift:'PM', rev:209,revhr:17.4,triphr:1.8,acc:77,can:8, idle:33,util:61,zone:'City Centre', comm:65},
    {r:12, id:'drv-12', n:'Radoslaw Stefan Brozek',      car:'TR2536', brand:'TESLA MODEL 3', shift:'AM', rev:203,revhr:16.9,triphr:1.7,acc:76,can:9, idle:35,util:59,zone:'Business Park',comm:65},
    {r:13, id:'drv-13', n:'Don August Tomte Mendonca',   car:'TR2536', brand:'NIO ET5',       shift:'PM', rev:196,revhr:16.3,triphr:1.7,acc:75,can:9, idle:36,util:58,zone:'Business Park',comm:65},
    {r:14, id:'drv-14', n:'Hokam Ali',                   car:'TR3319', brand:'TESLA MODEL 3', shift:'AM', rev:189,revhr:15.8,triphr:1.6,acc:74,can:9, idle:37,util:57,zone:'City Centre', comm:65},
    {r:15, id:'drv-15', n:'Abdulqadir Abukar Ali',       car:'TR709',  brand:'TESLA MODEL S', shift:'AM', rev:182,revhr:15.2,triphr:1.5,acc:74,can:9, idle:38,util:56,zone:'Airport',     comm:65},
    {r:16, id:'drv-16', n:'Petros Bampos',               car:'TR3323', brand:'KIA NIRO',      shift:'AM', rev:174,revhr:14.5,triphr:1.5,acc:73,can:10,idle:39,util:55,zone:'City Centre', comm:65},
    {r:17, id:'drv-17', n:'Geir Erik Paulsen',           car:'TR3323', brand:'KIA NIRO',      shift:'PM', rev:167,revhr:13.9,triphr:1.4,acc:72,can:10,idle:41,util:53,zone:'City Centre', comm:65},
    {r:18, id:'drv-18', n:'Mubarak Warith Salti',        car:'TR3320', brand:'NIO EL6',       shift:'AM', rev:158,revhr:13.2,triphr:1.3,acc:70,can:11,idle:43,util:51,zone:'Suburbs N',   comm:65},
    {r:19, id:'drv-19', n:'Radu Mihai Sandor',           car:'TR3320', brand:'NIO EL6',       shift:'PM', rev:149,revhr:12.4,triphr:1.3,acc:68,can:12,idle:44,util:50,zone:'Suburbs N',   comm:65},
  ];

  const vehicles = [
    {id:'TR2518',    make:'NIO',   model:'ET5',      fuel:'Electric', rev:298,profit:178,cpkm:0.38,tkm:310,bkm:238,ikm:72, down:4,  drivers:['Olsztynski Mariusz Zbigniew'],                        shifts:1, status:'active'},
    {id:'TR2537',    make:'NIO',   model:'EL6',      fuel:'Electric', rev:281,profit:161,cpkm:0.39,tkm:291,bkm:220,ikm:71, down:5,  drivers:['Armand Ionut Neculaita'],                             shifts:1, status:'active'},
    {id:'TR2540',    make:'NIO',   model:'ET5',      fuel:'Electric', rev:264,profit:148,cpkm:0.39,tkm:274,bkm:207,ikm:67, down:6,  drivers:['Szymon Silay Khassany'],                              shifts:1, status:'active'},
    {id:'TR732',     make:'NIO',   model:'EL6',      fuel:'Electric', rev:251,profit:138,cpkm:0.40,tkm:261,bkm:197,ikm:64, down:6,  drivers:['Piotr Nowak'],                                        shifts:1, status:'active'},
    {id:'TR2519',    make:'Tesla', model:'Model Y',  fuel:'Electric', rev:244,profit:132,cpkm:0.41,tkm:254,bkm:190,ikm:64, down:7,  drivers:['Faniel Tsegay Weldetnase'],                           shifts:1, status:'active'},
    {id:'TR2520',    make:'NIO',   model:'ET5',      fuel:'Electric', rev:238,profit:126,cpkm:0.41,tkm:248,bkm:185,ikm:63, down:7,  drivers:['Aram Khalandy'],                                      shifts:1, status:'active'},
    {id:'TR2539',    make:'NIO',   model:'ET5',      fuel:'Electric', rev:449,profit:248,cpkm:0.39,tkm:468,bkm:364,ikm:104,down:5,  drivers:['Sofiullah Razai','Imran Shinwari'],                   shifts:2, status:'shared'},
    {id:'TR2516',    make:'NIO',   model:'ET5',      fuel:'Electric', rev:426,profit:228,cpkm:0.40,tkm:442,bkm:340,ikm:102,down:6,  drivers:['Mateusz Kamil Golik','Martin Pastor'],                shifts:2, status:'shared'},
    {id:'TR2536',    make:'Tesla', model:'Model 3',  fuel:'Electric', rev:399,profit:206,cpkm:0.41,tkm:414,bkm:316,ikm:98, down:7,  drivers:['Radoslaw Stefan Brozek','Don August Tomte Mendonca'],shifts:2, status:'shared'},
    {id:'TR3323',    make:'Kia',   model:'Niro',     fuel:'Hybrid',   rev:341,profit:162,cpkm:0.43,tkm:354,bkm:268,ikm:86, down:8,  drivers:['Petros Bampos','Geir Erik Paulsen'],                  shifts:2, status:'shared'},
    {id:'TR3320',    make:'NIO',   model:'EL6',      fuel:'Electric', rev:307,profit:138,cpkm:0.42,tkm:318,bkm:238,ikm:80, down:9,  drivers:['Mubarak Warith Salti','Radu Mihai Sandor'],           shifts:2, status:'shared'},
    {id:'TR2597',    make:'Tesla', model:'Model 3',  fuel:'Electric', rev:224,profit:108,cpkm:0.42,tkm:233,bkm:172,ikm:61, down:8,  drivers:['Alaa Haithem Alnaeb'],                                shifts:1, status:'active'},
    {id:'TR3319',    make:'Tesla', model:'Model 3',  fuel:'Electric', rev:189,profit: 84,cpkm:0.43,tkm:196,bkm:141,ikm:55, down:9,  drivers:['Hokam Ali'],                                          shifts:1, status:'active'},
    {id:'TR709',     make:'Tesla', model:'Model S',  fuel:'Electric', rev:182,profit: 76,cpkm:0.44,tkm:188,bkm:134,ikm:54, down:10, drivers:['Abdulqadir Abukar Ali'],                              shifts:1, status:'active'},
    // No-driver cars (sitting idle, accruing fixed costs)
    {id:'TR2517',    make:'Tesla', model:'Model S',  fuel:'Electric', rev:0, profit:-48,cpkm:0, tkm:0,bkm:0,ikm:0, down:100,drivers:['— No Driver —'],       shifts:0, status:'no-driver'},
    {id:'TR731',     make:'',      model:'VITO',     fuel:'Diesel',   rev:0, profit:-32,cpkm:0, tkm:0,bkm:0,ikm:0, down:100,drivers:['— No Driver —'],       shifts:0, status:'no-driver'},
    {id:'TV1409721', make:'',      model:'SPRINTER', fuel:'Diesel',   rev:0, profit:-38,cpkm:0, tkm:0,bkm:0,ikm:0, down:100,drivers:['— No Driver —'],       shifts:0, status:'no-driver'},
    // Workshop cars
    {id:'TR2538',    make:'NIO',   model:'ET5',      fuel:'Electric', rev:0, profit:-44,cpkm:0, tkm:0,bkm:0,ikm:0, down:100,drivers:['— In Workshop —'],     shifts:0, status:'workshop'},
    {id:'TR3338',    make:'',      model:'VITO',     fuel:'Diesel',   rev:0, profit:-31,cpkm:0, tkm:0,bkm:0,ikm:0, down:100,drivers:['— In Workshop —'],     shifts:0, status:'workshop'},
  ];

  // Fleet-level KPIs — canonical values that every page should show
  const kpis = {
    revenueToday:   55430, // NOK gross
    netRevenue:     47115,
    netProfit:      9200,
    marginPct:      16.6,
    breakEven:      38800,
    tripsToday:     189,
    avgTripFare:    25.77,
    driversTotal:   19,
    driversActive:  16,
    vehiclesTotal:  14,
    vehiclesOnRoad: 11,
    vehiclesShop:   2,
    vehiclesIdle:   1,
  };

  // ── Live-sync API (opt-in — UI calls FleetData.load() when ready) ─
  let liveCache = null;
  async function load(){
    if (liveCache) return liveCache;
    const out = { drivers, vehicles, kpis };
    try {
      const [dr, vh, st] = await Promise.allSettled([
        fetch('/api/drivers').then(r => r.ok ? r.json() : null),
        fetch('/api/vehicles').then(r => r.ok ? r.json() : null),
        fetch('/api/stats').then(r => r.ok ? r.json() : null),
      ]);
      const d = dr.status === 'fulfilled' && Array.isArray(dr.value) ? dr.value : null;
      const v = vh.status === 'fulfilled' && Array.isArray(vh.value) ? vh.value : null;
      const s = st.status === 'fulfilled' && st.value ? st.value : null;
      if (d && d.length) out.drivers  = d;
      if (v && v.length) out.vehicles = v;
      if (s && typeof s === 'object') out.kpis = Object.assign({}, kpis, s);
    } catch (err) {
      if (window.Sentry && typeof window.Sentry.captureException === 'function') {
        window.Sentry.captureException(err, { tags: { where: 'FleetData.load' } });
      }
    }
    liveCache = out;
    return out;
  }

  // Mutate the exported arrays in place with live data. Anyone who captured
  // `FleetData.drivers` earlier will see the new rows without a re-import.
  async function refresh(){
    const live = await load();
    liveCache = null; // allow future re-fetch
    drivers.splice(0, drivers.length, ...(live.drivers || []));
    vehicles.splice(0, vehicles.length, ...(live.vehicles || []));
    if (live.kpis) Object.assign(kpis, live.kpis);
    return { drivers, vehicles, kpis };
  }

  // Non-blocking bootstrap: on page load, try hydrating from the API.
  // If successful AND data differs from baked-in, fire a custom event so
  // the dashboard can show a 'New data available — Reload' banner.
  function bootstrap(){
    const baselineDriverCount  = drivers.length;
    const baselineVehicleCount = vehicles.length;
    load().then(live => {
      if (!live) return;
      const d = live.drivers || [];
      const v = live.vehicles || [];
      const diff = (d.length !== baselineDriverCount) || (v.length !== baselineVehicleCount);
      if (diff) {
        try {
          window.dispatchEvent(new CustomEvent('fleetdata:live-available', { detail: { counts: { drivers: d.length, vehicles: v.length } } }));
        } catch (e){}
      }
    }).catch(() => { /* silent */ });
  }
  // Run bootstrap after a tick so page-render scripts complete first
  setTimeout(bootstrap, 200);

  function findDriver(idOrCar){ return drivers.find(d => d.id === idOrCar || d.car === idOrCar); }
  function findVehicle(id){ return vehicles.find(v => v.id === id); }

  return { drivers, vehicles, kpis, load, refresh, findDriver, findVehicle };
})();
