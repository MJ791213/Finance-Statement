/* Default categories and keyword rules. Everything here can be edited in the
 * "Rules & Settings" tab; these are only the starting point. */
(function (root) {
  'use strict';
  const FS = root.FS;

  // "excluded" categories are not counted as spending (card payments, transfers, income).
  const DEFAULT_CATEGORIES = [
    { name: 'Grocery', color: '#2e7d32' },
    { name: 'Restaurant/Eat Out', color: '#e65100' },
    { name: 'Fitness Club', color: '#6a1b9a' },
    { name: 'Entertainment Sub', color: '#ad1457' },
    { name: 'Travel (Hotel & Trans)', color: '#1565c0' },
    { name: 'AI Tool Sub', color: '#00838f' },
    { name: 'Shopping', color: '#795548' },
    { name: 'Medical', color: '#c62828' },
    { name: 'Gas & Auto', color: '#546e7a' },
    { name: 'Bills & Utilities', color: '#9e9d24' },
    { name: 'Other', color: '#757575' },
    { name: 'Payments & Transfers', color: '#90a4ae', excluded: true },
    { name: 'Income', color: '#43a047', excluded: true },
  ];

  const TRAVEL = 'Travel (Hotel & Trans)';
  const RESTAURANT = 'Restaurant/Eat Out';

  const words = (s) => s.split('|').map((x) => x.trim()).filter(Boolean);

  // Merchant keywords matched against bank transaction descriptions.
  // When several rules match, the longest keyword wins (so "UBER EATS" beats "UBER").
  const MERCHANT_KEYWORDS = {
    'Grocery': words('whole foods|wholefds|trader joe|safeway|kroger|costco whse|costco wholesale|aldi|publix|wegmans|sprouts|heb|h-e-b|albertsons|vons|ralphs|food lion|stop & shop|harris teeter|meijer|h mart|99 ranch|ranch 99|instacart|grocery|groceries|supermarket|amazon fresh|weee|lucky supermarket|smart & final|winco|food 4 less|fred meyer|hy-vee|giant eagle|market basket|shoprite|save mart|grocery outlet|mitsuwa|nijiya|marukai|tokyo central|t&t'),
    [RESTAURANT]: words('restaurant|cafe|café|coffee|starbucks|dunkin|mcdonald|chipotle|taco|pizza|burger|sushi|grill|kitchen|bistro|pub|diner|bakery|doordash|dd *doordash|uber eats|ubereats|uber *eats|grubhub|postmates|caviar|panera|chick-fil-a|wendy|kfc|panda express|sweetgreen|shake shack|in-n-out|five guys|domino|papa john|peet|boba|ramen|pho|tst*|tst *|noodle|bbq|steakhouse|brewing|tea house|dim sum|cava|subway|jamba|wingstop|popeyes|ihop|denny|olive garden|cheesecake factory|chili\'s|applebee|buffalo wild|raising cane|jack in the box|carl\'s jr|taco bell|del taco|el pollo loco|dutch bros|philz|blue bottle|85c|tim hortons|krispy kreme|baskin|cold stone|yogurt|eatery|cantina|tavern|izakaya|bar & grill|food truck|breakfast|brunch|cafeteria|deli|creamery|gelato|donut|bagel|smoothie|juice bar|wings|poke|kebab|shawarma|curry|thai|taqueria|trattoria|osteria|brasserie|chophouse|oyster|seafood|crab|bento'),
    'Fitness Club': words('gym|fitness|planet fitness|24 hour fitness|la fitness|equinox|orangetheory|crossfit|yoga|pilates|peloton|classpass|life time|lifetime fitness|anytime fitness|gold\'s gym|crunch|ymca|barry\'s|soulcycle|f45|climbing|bouldering|club pilates|xponential|mindbody|strava'),
    'Entertainment Sub': words('netflix|hulu|disney plus|disneyplus|disney+|hbo|max.com|hbomax|spotify|youtube premium|youtubepremium|youtube tv|google *youtube|paramount+|paramount plus|peacock|prime video|amazon prime|audible|kindle unltd|kindle unlimited|siriusxm|pandora|crunchyroll|twitch|xbox|playstation|nintendo|apple tv|apple music|fubotv|sling tv|espn+|discovery+|tidal|deezer|patreon|nyt|new york times|wsj|washington post'),
    [TRAVEL]: words('airline|airlines|air lines|united|delta air|american air|aa.com|southwest|jetblue|alaska air|spirit airl|frontier airl|hawaiian air|air canada|eva air|china airlines|cathay|emirates|qatar|lufthansa|british airways|air france|klm|singapore air|korean air|ana air|japan airlines|starlux|marriott|hilton|hyatt|ihg|holiday inn|sheraton|westin|courtyard|hampton inn|doubletree|embassy suites|four seasons|ritz|wyndham|best western|la quinta|motel|hotel|resort|airbnb|vrbo|booking.com|expedia|hotels.com|priceline|agoda|trip.com|kayak|uber|lyft|amtrak|greyhound|hertz|avis|enterprise rent|national car|budget rent|alamo|sixt|turo|parking|toll|fastrak|ez pass|e-zpass|clipper|mta|bart|metro transit|caltrain|airport|tsa precheck|global entry|clear secure|taxi|cab'),
    'AI Tool Sub': words('openai|chatgpt|anthropic|claude.ai|claude|midjourney|perplexity|github copilot|github|cursor|anysphere|jasper|copy.ai|elevenlabs|runway|poe.com|character.ai|gemini|google one|microsoft copilot|copilot pro|notion ai|replit|deepl|otter.ai|descript|suno|leonardo.ai|huggingface|hugging face|x.ai|grok|mistral'),
    'Shopping': words('amazon|amzn|amazon mktp|amazon.com|target|walmart|wal-mart|best buy|ebay|etsy|macy|nordstrom|tj maxx|tjmaxx|marshalls|ross stores|home depot|lowe\'s|lowes|ikea|apple store|apple.com/us|uniqlo|zara|h&m|nike|old navy|gap|shein|temu|wayfair|sephora|ulta|kohl|bed bath|costco.com|daiso|muji|rei|dick\'s sporting|michaels|joann|petco|petsmart|chewy|staples|office depot|bath & body|victoria|lululemon|adidas|foot locker|tj max|burlington|homegoods|williams sonoma|crate & barrel|pottery barn|container store|aliexpress'),
    'Medical': words('pharmacy|cvs|walgreens|rite aid|medical|clinic|hospital|dental|dentist|doctor|urgent care|labcorp|quest diag|kaiser|optometr|vision|eye care|physical therapy|chiropract|dermatolog|pediatric|copay|health center|healthcare|orthodont|radiology|imaging|lab corp|one medical|teladoc|zocdoc|goodrx|md office|medicine|surgery|psych|therapy|counsel'),
    'Gas & Auto': words('shell oil|shell service|chevron|exxon|mobil|arco|76 -|valero|costco gas|gasoline|fuel|car wash|jiffy lube|autozone|o\'reilly|pep boys|dmv|tesla supercharger|chargepoint|evgo|electrify america|firestone|discount tire|midas|gas station|circle k|7-eleven|speedway|sunoco|marathon petro|wawa|sheetz|quiktrip|maverik|conoco|phillips 66|sinclair'),
    'Bills & Utilities': words('comcast|xfinity|at&t|verizon|t-mobile|tmobile|sprint|pg&e|edison|electric|water dept|utility|utilities|insurance|geico|state farm|progressive|allstate|spectrum|cox comm|google fi|mint mobile|visible|icloud|google storage|dropbox|microsoft 365|adobe|sce|sdge|con ed|duke energy|waste management|republic services|rent|hoa'),
    'Payments & Transfers': words('payment thank you|payment - thank you|autopay|auto pay|online payment|mobile payment|epayment|e-payment|transfer|xfer|zelle|venmo|cash app|paypal transfer|credit card payment|card payment|ach pmt|bill pay|online banking payment|payment received|des:payment|crd pmt|epay|credit crd|crd epay|card services pmt|cardmember serv|applecard gsbank|amex epayment|discover e-payment|citi autopay|bill payment'),
    'Income': words('payroll|direct dep|direct deposit|salary|dividend|interest paid|interest payment|deposit from|ach credit|irs treas|tax refund|reimbursement'),
  };

  // Keywords matched against receipt line items (e.g. Amazon product names).
  // Items that match nothing fall back to the receipt default category (Shopping).
  const ITEM_KEYWORDS = {
    'Grocery': words('food|snack|coffee|tea bags|green tea|cereal|organic|chocolate|nuts|almond|protein bar|granola|sparkling water|water bottles|juice|sauce|spice|seasoning|pasta|rice|olive oil|candy|cookies|chips|crackers|beverage|k-cup|kcup|pantry|oatmeal|honey|jerky|flour|sugar|soup|noodles|ramen|peanut butter|milk|eggs|fresh produce|fruit|vegetable|frozen|creamer|kombucha|soda|seltzer|gum|baking'),
    'Medical': words('vitamin|supplement|ibuprofen|acetaminophen|tylenol|advil|aleve|allergy|claritin|zyrtec|bandage|band-aid|first aid|thermometer|medicine|medication|pain relief|probiotic|blood pressure|contact lens|prescription|covid test|antigen test|pregnancy test|cough|cold & flu|nyquil|dayquil|antacid|melatonin|fish oil|omega-3|multivitamin|eye drops|saline|hydrocortisone|neosporin|heating pad|knee brace|compression|orthotic|hearing aid|glucose|insulin|pill organizer'),
    'Entertainment Sub': words('prime video|kindle unlimited|audible membership|music unlimited|prime membership'),
    'AI Tool Sub': words('chatgpt|openai|claude'),
  };

  // Hints from the "Category" column some bank CSV exports include (e.g. Chase).
  const BANK_CATEGORY_HINTS = [
    [/grocer/i, 'Grocery'],
    [/food|drink|dining|restaurant/i, RESTAURANT],
    [/travel|airline|hotel|lodging|transport|rideshare/i, TRAVEL],
    [/health|medical|pharmac/i, 'Medical'],
    [/gas|automotive|auto/i, 'Gas & Auto'],
    [/bills|utilit|insurance|phone/i, 'Bills & Utilities'],
    [/shopping|merchandise|home|personal/i, 'Shopping'],
    [/entertain/i, 'Entertainment Sub'],
    [/payment|transfer/i, 'Payments & Transfers'],
    [/income|deposit|payroll/i, 'Income'],
  ];

  function rulesFromKeywords(map, kind) {
    const out = [];
    for (const [category, list] of Object.entries(map)) {
      for (const pattern of list) out.push({ pattern, category, kind, builtin: true });
    }
    return out;
  }

  function defaultRules() {
    return [...rulesFromKeywords(MERCHANT_KEYWORDS, 'merchant'), ...rulesFromKeywords(ITEM_KEYWORDS, 'item')];
  }

  const regexCache = new Map();
  function ruleRegex(pattern) {
    let re = regexCache.get(pattern);
    if (!re) {
      const p = pattern.trim();
      if (p.startsWith('/') && p.lastIndexOf('/') > 0) {
        try { re = new RegExp(p.slice(1, p.lastIndexOf('/')), 'i'); } catch (e) { re = /$^/; }
      } else {
        const body = FS.escapeRegex(p.toUpperCase()).replace(/\s+/g, '\\s*');
        const start = /^[A-Z0-9]/.test(p.toUpperCase()) ? '(?:^|[^A-Z0-9])' : '';
        const end = /[A-Z0-9]$/.test(p.toUpperCase()) ? '(?=$|[^A-Z0-9])' : '';
        re = new RegExp(start + body + end);
      }
      regexCache.set(pattern, re);
    }
    return re;
  }

  /** Find the best rule for a text. User rules always win over built-in ones;
   *  within each group the longest (most specific) keyword wins. */
  function matchRule(text, rules, kind) {
    const upper = String(text || '').toUpperCase();
    let best = null;
    for (const r of rules) {
      if (r.disabled || (r.kind || 'merchant') !== kind) continue;
      const re = ruleRegex(r.pattern);
      const ok = re.flags.includes('i') ? re.test(text) : re.test(upper);
      if (!ok) continue;
      if (!best) { best = r; continue; }
      const rank = (x) => (x.builtin ? 0 : 1e6) + x.pattern.length;
      if (rank(r) > rank(best)) best = r;
    }
    return best;
  }

  function bankCategoryHint(bankCategory) {
    if (!bankCategory) return null;
    for (const [re, cat] of BANK_CATEGORY_HINTS) if (re.test(bankCategory)) return cat;
    return null;
  }

  // Merchants that signal lodging / car rental (charged on site, so their dates mark a trip).
  const LODGING_RE = /\b(MARRIOTT|HILTON|HYATT|IHG|HOLIDAY INN|SHERATON|WESTIN|COURTYARD|HAMPTON|DOUBLETREE|EMBASSY SUITES|FOUR SEASONS|RITZ|WYNDHAM|BEST WESTERN|LA QUINTA|MOTEL|HOTEL|RESORT|INN\b|LODGE|SUITES|HERTZ|AVIS|ENTERPRISE RENT|NATIONAL CAR|BUDGET RENT|ALAMO|SIXT)/;
  // Prepaid booking sites and airlines are usually charged weeks before the trip.
  const PREPAID_TRAVEL_RE = /\b(AIRBNB|VRBO|BOOKING\.COM|EXPEDIA|HOTELS\.COM|PRICELINE|AGODA|TRIP\.COM|KAYAK|AIRLINE|AIRLINES|AIR LINES|UNITED|DELTA|SOUTHWEST|JETBLUE|ALASKA AIR|AMERICAN AIR|AA\.COM)/;

  FS.Categories = {
    DEFAULT_CATEGORIES, TRAVEL, RESTAURANT, defaultRules, matchRule, bankCategoryHint,
    LODGING_RE, PREPAID_TRAVEL_RE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
