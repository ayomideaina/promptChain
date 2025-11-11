// prompt-chain.js
// Implements a deterministic, heuristic-driven 5-stage prompt chain for customer support.
// Exports runPromptChain(query) which returns an array of five intermediate results.

(function(global){
  const CATEGORIES = [
    "Account Opening",
    "Billing Issue",
    "Account Access",
    "Transaction Inquiry",
    "Card Services",
    "Account Statement",
    "Loan Inquiry",
    "General Information"
  ];

  const KEYWORDS = {
    "Account Opening": ["open account","create account","new account","signup","sign up","register"],
    "Billing Issue": ["bill","billing","invoice","charged","charge","overcharged","fee","fees","refund"],
    "Account Access": ["login","log in","password","password reset","locked","unlock","can't access","cannot access","sign in","signin","forgot password","2fa","two-factor"],
    "Transaction Inquiry": ["transaction","charge","payment","withdrawal","deposit","merchant","purchase","unauthoriz","dispute"],
    "Card Services": ["card","credit card","debit card","lost card","stolen","replace card","activate card","block card","freeze card","unfreeze"],
    "Account Statement": ["statement","statements","monthly statement","e-statement","e statement","account statement"],
    "Loan Inquiry": ["loan","mortgage","interest rate","apply loan","loan application","refinance","installment"],
    "General Information": ["hours","where","location","info","information","how do I","help","what is"]
  };

  // Required fields by category to service the request
  const REQUIRED_FIELDS = {
    "Account Opening": ["full_name","id_type","id_number","product_type","initial_deposit"],
    "Billing Issue": ["billing_date","amount","billing_reference","service_description"],
    "Account Access": ["account_type","username_or_email","device_or_browser","error_message","last_successful_login"],
    "Transaction Inquiry": ["transaction_date","amount","merchant","transaction_id","card_last4"],
    "Card Services": ["card_type","card_last4","issue_type","reported_date"],
    "Account Statement": ["statement_period","delivery_method","email_or_address"],
    "Loan Inquiry": ["loan_type","requested_amount","term_or_tenor","application_id"],
    "General Information": ["topic"]
  };

  // Utility regexes
  const amountRegex = /\$?\s?([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i;
  const dateRegex = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\b(?:today|yesterday|tomorrow)\b)\b/i;
  const last4Regex = /(?:\b|\D)(\d{4})(?:\b|\D)/;
  const txnIdRegex = /(?:txn|transaction|ref|refno|id)[:#\s]*([A-Z0-9-]{4,30})/i;

  function normalizeText(s){
    return (s||"").toLowerCase();
  }

  function interpretIntent(query){
    // produce a short natural-language intent summary
    const q = normalizeText(query);
    let verbs = [];
    if(/disput|unauthoriz|fraud|chargeback/.test(q)) verbs.push('dispute a potentially fraudulent or unauthorized transaction');
    if(/open account|create account|sign up|register|new account/.test(q)) verbs.push('open a new account');
    if(/password|forgot|reset|locked|can't access|cannot access|login|log in|sign in/.test(q)) verbs.push('regain account access or reset credentials');
    if(/bill|billing|invoice|overcharged|refund|fee/.test(q)) verbs.push('report a billing or charge issue');
    if(/statement|monthly statement|e-statement/.test(q)) verbs.push('request or enquire about account statements');
    if(/loan|mortgage|refinance|interest rate/.test(q)) verbs.push('inquire about loans or financing options');
    if(/card|lost card|stolen|activate card|replace card|block card/.test(q)) verbs.push('manage card services (lost/stolen/replace/activate)');

    // fallback: try to capture an object and a short summary
    let objectMatch = query.match(/\b(transaction|card|account|statement|loan|bill|payment|password|login)\b/i);
    let objectText = objectMatch ? objectMatch[0] : null;

    let summary = '';
    if(verbs.length>0){
      summary = `Customer intends to ${verbs.join(' and ')}.`;
      if(objectText) summary += ` Mentioned: ${objectText}.`;
    } else {
      // default short paraphrase
      summary = `Customer asks: "${query.trim()}"`;
    }
    return summary;
  }

  function mapToPossibleCategories(query){
    const q = normalizeText(query);
    const scores = {};
    CATEGORIES.forEach(cat => scores[cat]=0);
    for(const [cat, kws] of Object.entries(KEYWORDS)){
      kws.forEach(kw => {
        // match whole words or phrases
        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
        if(re.test(query)) scores[cat] += 1;
      });
    }
    // choose categories with score >=1, sorted by score desc
    const possible = Object.entries(scores).filter(([,score])=>score>0)
      .sort((a,b)=>b[1]-a[1]).map(([cat])=>cat);
    if(possible.length===0) return ['General Information'];
    return possible;
  }

  function chooseMostAppropriateCategory(possibleCategories, query){
    if(!possibleCategories || possibleCategories.length===0) return 'General Information';
  }

  function extractAdditionalDetails(query, chosenCategory){
    const needed = REQUIRED_FIELDS[chosenCategory] || [];
    const found = {};
    const lower = query;

    const amt = query.match(amountRegex);
    if(amt) found.amount = amt[1];

    const dt = query.match(dateRegex);
    if(dt) found.date = dt[1];

    const last4 = query.match(last4Regex);
    if(last4) found.card_last4 = last4[1];

    const txn = query.match(txnIdRegex);
    if(txn) found.transaction_id = txn[1];


    const email = query.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if(email) found.email = email[1];

    const phone = query.match(/(\+?\d[\d ()-]{6,}\d)/);
    if(phone) found.phone = phone[1];


    const name = query.match(/([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if(name) found.full_name = name[1];

    // Determine account type words
    const acctType = query.match(/(savings|checking|current|business|personal|credit)/i);
    if(acctType) found.account_type = acctType[1];

    // Issue specifics
    if(/lost|stolen/.test(lower)) found.issue_type = 'lost_or_stolen';
    if(/activate|activation/.test(lower)) found.issue_type = 'activate_card';
    if(/replace|new card|reissue/.test(lower)) found.issue_type = 'replace_card';
    if(/refund|overcharged|overcharged|credit back/.test(lower)) found.issue_type = 'billing_dispute';


    const extracted = {};
    needed.forEach(field => {
      if(field==='amount' && found.amount) extracted.amount = found.amount;
      else if(field==='transaction_date' && found.date) extracted.transaction_date = found.date;
      else if(field==='billing_date' && found.date) extracted.billing_date = found.date;
      else if(field==='reported_date' && found.date) extracted.reported_date = found.date;
      else if(field==='card_last4' && found.card_last4) extracted.card_last4 = found.card_last4;
      else if(field==='transaction_id' && found.transaction_id) extracted.transaction_id = found.transaction_id;
      else if(field==='email_or_address' && found.email) extracted.email_or_address = found.email;
      else if(field==='username_or_email' && (found.email || /\b[a-z0-9._%+-]+\b/i.test(query))) extracted.username_or_email = found.email || null;
      else if(field==='full_name' && found.full_name) extracted.full_name = found.full_name;
      else if(field==='account_type' && found.account_type) extracted.account_type = found.account_type;
      else if(field==='issue_type' && found.issue_type) extracted.issue_type = found.issue_type;
      else if(['id_type','id_number','product_type','billing_reference','service_description','last_successful_login','merchant','statement_period','delivery_method','loan_type','requested_amount','term_or_tenor','application_id'].includes(field)){

        const merchant = query.match(/(?:at|from)\s+([A-Z0-9a-z &'-]{3,30})/);
        if(field==='merchant' && merchant) extracted.merchant = merchant[1];

        if(field==='requested_amount' && found.amount) extracted.requested_amount = found.amount;
      }
    });

    const missing = [];
    needed.forEach(f => {
      if(!(f in extracted)) missing.push(f);
    });

    return { found: extracted, missing };
  }

  function generateShortResponse(chosenCategory, extractedDetails, intentSummary){

    const missing = extractedDetails.missing || [];
    let resp = '';

    switch(chosenCategory){
      case 'Account Opening':
        resp = 'Thanks for your interest in opening an account. To get started, please provide the following: ' + (missing.length? missing.join(', '): 'your full name, ID details, and desired product.');
        break;
      case 'Billing Issue':
        resp = 'I can help investigate this billing issue. ' + (missing.length? 'Please share: ' + missing.join(', ')+'.' : 'I have enough to begin an investigation and will update you within 3 business days.');
        break;
      case 'Account Access':
        resp = 'I see you have an access issue. ' + (missing.length? 'Please tell us your account type and any error messages you see, plus the email/username.' : 'Try resetting your password via the "Forgot password" link; tell me if that fails.');
        break;
      case 'Transaction Inquiry':
        resp = 'I can look into this transaction. ' + (missing.length? 'Please provide: ' + missing.join(', ')+'.' : 'We will review the transaction and get back within 2 business days.');
        break;
      case 'Card Services':
        resp = 'Card services handled — I can block or replace a card. ' + (missing.length? 'Please confirm: ' + missing.join(', ')+'.' : 'I will proceed to block the card and order a replacement unless you tell me otherwise.');
        break;
      case 'Account Statement':
        resp = 'I can provide statements. ' + (missing.length? 'Please specify: ' + missing.join(', ')+'.' : 'We will email your statement shortly.');
        break;
      case 'Loan Inquiry':
        resp = 'I can assist with loan inquiries. ' + (missing.length? 'Please tell us desired amount, loan type, and term.' : 'I will share options and estimated rates for the requested loan.');
        break;
      default:
        resp = 'Thanks for reaching out. ' + (missing.length? 'Could you clarify: ' + missing.join(', ')+'.' : 'How can I assist further?');
    }


    resp += ' — Support Bot';
    resp = resp + '\n\n(Interpretation: ' + intentSummary + ')';
    return resp;
  }

  function runPromptChain(query){
    if(typeof query !== 'string') throw new Error('query must be a string');
    const intent = interpretIntent(query);

    const possible = mapToPossibleCategories(query);

    const chosen = chooseMostAppropriateCategory(possible, query);


    const extraction = extractAdditionalDetails(query, chosen);

   
    const response = generateShortResponse(chosen, extraction, intent);

    return [intent, possible, chosen, extraction, response];
  }


  if(typeof module !== 'undefined' && module.exports) module.exports = { runPromptChain };
  if(typeof window !== 'undefined') window.runPromptChain = runPromptChain;
  if(typeof global !== 'undefined') global.runPromptChain = runPromptChain;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
