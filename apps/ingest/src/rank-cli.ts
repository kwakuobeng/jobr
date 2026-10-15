import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { rankJobs, RankingProfileSchema } from "./rank.js";
import { JobListingSchema } from "./types.js";
import { dataDir, dataPath } from "./config.js";
const profilePath = process.env.JOBR_PROFILE_PATH ?? process.argv[2];
if (!profilePath) throw new Error("Provide JOBR_PROFILE_PATH or a profile JSON path argument");
const profile = RankingProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
const jobsPath = process.env.JOBR_JOBS_PATH ?? dataPath("jobs-latest.json");
const jobs = z.array(JobListingSchema).parse(JSON.parse(readFileSync(jobsPath, "utf8")));
const topN = z.coerce.number().int().min(1).max(1000).parse(process.env.TOPN ?? 50);
const trackerPath = process.env.JOBR_TRACKER_PATH;
const result = rankJobs(jobs, profile, topN, trackerPath ? readFileSync(trackerPath, "utf8") : undefined);
mkdirSync(dataDir, { recursive: true });
writeFileSync(process.env.JOBR_RANKED_PATH ?? dataPath("ranked-top.json"), JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2));
const md = ["# Jobr ranked report", "", `Filter funnel: ${JSON.stringify(result.filterStats)}`, "",
  ...result.top.map((j, i) => `${i + 1}. ${j.company} — ${j.title} (${j.score}): ${j.url}`)].join("\n");
writeFileSync(process.env.JOBR_REPORT_PATH ?? dataPath("ranked-report.md"), md + "\n");
console.log(JSON.stringify({ event: "ranking_summary", ...result.filterStats, returned: result.top.length }));
