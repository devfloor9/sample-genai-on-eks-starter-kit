#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "vLLM";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["HF_TOKEN"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`kubectl apply -f ${path.join(DIR, "namespace.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc-huggingface-cache.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc-neuron-cache.yaml")}`;
  const secretTemplatePath = path.join(DIR, "secret.template.yaml");
  const secretRenderedPath = path.join(DIR, "secret.rendered.yaml");
  const secretTemplateString = fs.readFileSync(secretTemplatePath, "utf8");
  const secretTemplate = handlebars.compile(secretTemplateString);
  const secretVars = {
    HF_TOKEN: process.env.HF_TOKEN,
  };
  fs.writeFileSync(secretRenderedPath, secretTemplate(secretVars));
  await $`kubectl apply -f ${secretRenderedPath}`;
  const { models } = config["llm-model"]["vllm"];
  await utils.model.addModels(models, "llm-model", "vllm");

  // Kick off a background HuggingFace prefetch Job so subsequent pod starts hit
  // the cache. Runs concurrently with the actual vLLM pods; we don't block the
  // install on this — it finishes "in parallel" with node provisioning.
  const vllmCfg = config["llm-model"]["vllm"] || {};
  const prewarmOnInstall = vllmCfg.prewarmOnInstall !== false;
  if (prewarmOnInstall) {
    try {
      await prewarm();
    } catch (err) {
      console.warn(`⚠️  vLLM prewarm Job failed to dispatch: ${err.message || err}`);
    }
  }
}

// Resolve HuggingFace repo IDs for every deployable vLLM model by parsing the
// model-*.template.yaml manifests. Skips Neuron/cached variants whose first
// arg is a local path rather than an HF repo id.
const extractHfRepoId = (templatePath) => {
  const contents = fs.readFileSync(templatePath, "utf8");
  // Find the first `- <value>` line after `args:`
  const argsIdx = contents.search(/\n\s+args:\s*\n/);
  if (argsIdx === -1) return null;
  const rest = contents.slice(argsIdx);
  const match = rest.match(/\n\s+-\s+([^\s#\n]+)/);
  if (!match) return null;
  const candidate = match[1];
  // Valid HF repo id shape: org/name (no slashes beyond the namespace, no path prefix)
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(candidate)) return null;
  return candidate;
};

export async function prewarm() {
  const requiredEnvVars = ["HF_TOKEN"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const { models } = config["llm-model"]["vllm"];
  const deployable = (models || []).filter((m) => m.deploy);
  const repoIds = [];
  for (const m of deployable) {
    const tmpl = path.join(DIR, `model-${m.name}.template.yaml`);
    if (!fs.existsSync(tmpl)) continue;
    const repoId = extractHfRepoId(tmpl);
    if (repoId) repoIds.push(repoId);
  }
  if (repoIds.length === 0) {
    console.log("vllm prewarm: no HuggingFace repo ids resolved from deployable models, skipping.");
    return;
  }
  console.log(`vllm prewarm: prefetching ${repoIds.length} model(s) into EFS cache → ${repoIds.join(", ")}`);

  const { GHCR_IMAGE_PREFIX } = await utils.getImagePrefixes();
  const suffix = Date.now().toString(36);
  const templatePath = path.join(DIR, "prewarm-job.template.yaml");
  const renderedPath = path.join(DIR, `prewarm-job.rendered.yaml`);
  const tmpl = handlebars.compile(fs.readFileSync(templatePath, "utf8"));
  // Handlebars escapes default — embed the models_json as a literal string.
  const rendered = tmpl({
    JOB_SUFFIX: suffix,
    GHCR_IMAGE_PREFIX,
    MODELS_JSON: JSON.stringify(repoIds),
  });
  fs.writeFileSync(renderedPath, rendered);
  await $`kubectl apply -f ${renderedPath}`;
  console.log(`vllm prewarm: dispatched Job vllm-prewarm-${suffix} (follow with: kubectl -n vllm logs -l app.kubernetes.io/component=vllm-prewarm -f)`);
}

export async function uninstall() {
  const { models } = config["llm-model"]["vllm"];
  await utils.model.removeAllModels(models, "llm-model", "vllm");
  // Best-effort cleanup of any active/past prewarm Jobs so they don't linger
  // on uninstall. Ignored if none exist.
  await $`kubectl -n vllm delete job -l app.kubernetes.io/component=vllm-prewarm --ignore-not-found`.nothrow?.();
  await $`kubectl delete -f ${path.join(DIR, "secret.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc-huggingface-cache.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc-neuron-cache.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "namespace.yaml")} --ignore-not-found`;
}
