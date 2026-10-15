// Probe candidate slugs against all 4 public ATS APIs; write verified seed list.
import { writeFileSync } from "node:fs";
import { endpoints, fetchBoard } from "./adapters.js";
import type { AtsType, Board } from "./types.js";
const C = `gong outreach hubspot datadog airtable figma gusto brex asana dropbox cloudflare mongodb twilio okta elastic samsara toasttab lattice amplitude mixpanel braze contentsquare sproutsocial klaviyo highspot seismic clari apollo zoominfo 6sense demandbase gainsight pendo sprinklr yext procore servicetitan podium vanta drata rippling carta mercury plaid chime affirm robinhood coinbase stripe databricks snowflake hashicorp pagerduty newrelic sumologic smartsheet qualtrics invoca attentive iterable yotpo gorgias calendly loom miro notion airbnb lyft instacart discord reddit pinterest squarespace bitly grammarly duolingo coursera udemy 15five cultureamp bamboohr justworks namely netskope sentinelone lacework wiz abnormalsecurity arcticwolf tanium rubrik cohesity fivetran dbtlabsinc airbyte hightouch sigmacomputing thoughtspot celonis automationanywhere workato zapier clickup wrike harness gitlab jfrog postman launchdarkly optimizely contentful webflow vercel netlify supabase retool coda intercom front dialpad aircall talkdesk salesloft mindtickle showpad peopleai cognism leadiq usergems commonroom ramp linear openai posthog replit clay attio hex modal watershed deel remote oysterhr palantir wealthsimple lucid zoox jobber kong mistral anthropic scaleai benchling flexport navan tripactions checkr gem ashby greenhouse lever smartrecruiters Visa BoschGroup ServiceNow Equinix PublicisGroupe Experian Sodexo WesternDigital Skechers AveryDennison Ubisoft2 Canva Atlassian Spotify Square Block Doordash Doordashusa Chainguard Monzo Revolut Wise Klarna Personio Pipedrive Typeform Productboard Mural Envoy Ironclad Docusign Zuora Avalara Bill billcom Navan Expensify Tipalti Spendesk Pleo Payfit Algolia Sentry Grafana GrafanaLabs Temporal Cockroachlabs Planetscale Neon Airwallex Remitly Marqeta Toast Olo Lightspeed Shopify Bolt Faire Whatnot Thumbtack Nextdoor Yelp Zillow Redfin Opendoor Compass Built BuiltTechnologies Rokt Taboola Outbrain Moloco AppLovin Branch Iterable Amplitude Heap Fullstory Quantummetric Medallia Sprout Hootsuite Later Buffer Mailchimp Constantcontact Sendgrid Postscript Ometria Bloomreach Algolia Coveo Lucidworks Seismic Allego Highspot Vidyard Gong Chorus Momentum Avoma Fathom Otter Fireflies Dooly Scratchpad Tableau Looker Mode Hex Census Rudderstack Segment Mparticle Tealium`;
const slugs = [...new Set(C.split(/\s+/).map(s => s.toLowerCase()))];
const ats: AtsType[] = ["greenhouse","lever","ashby","smartrecruiters"];
const tasks = slugs.flatMap(s => ats.map(a => ({ s, a })));
const found: Board[] = []; let i = 0; let failures = 0;
import { seedPath, logFailure } from "./config.js";
async function worker() { while (i < tasks.length) { const task = tasks[i++]; if (!task) break; const { s, a } = task;
  try { const token = a === "smartrecruiters" ? s.charAt(0).toUpperCase()+s.slice(1) : s;
    const jobs = await fetchBoard({ ats: a, token, company: s, source: endpoints[a](token) });
    const n = jobs.length; const name = jobs[0]?.company;
    if (n > 0) found.push({ ats: a, token: a === "smartrecruiters" ? s.charAt(0).toUpperCase()+s.slice(1) : s, company: name ?? s, jobsAtVerify: n,
      source: endpoints[a](s), verifiedAt: new Date().toISOString() });
  } catch (error: unknown) { failures++; logFailure(a, s, error); } } }
await Promise.all(Array.from({ length: 16 }, worker));
found.sort((x, y) => x.ats.localeCompare(y.ats) || x.token.localeCompare(y.token));
writeFileSync(seedPath, JSON.stringify(found, null, 2));
console.log(`probed ${slugs.length} slugs x4; verified boards: ${found.length}`);
for (const a of ats) console.log(a, found.filter(f => f.ats === a).length);

console.log(JSON.stringify({ event: "discover_summary", boards: tasks.length, failures, verified: found.length }));
