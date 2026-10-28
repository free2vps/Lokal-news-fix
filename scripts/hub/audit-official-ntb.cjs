#!/usr/bin/env node
/*
 * Single, bounded discovery pass for the government sources requested by the owner.
 * It never opens individual article pages, never posts, and never changes any database.
 * Each origin's robots policy is checked before a supplied listing or advertised feed.
 * Explicitly running this script makes live network requests; it is never run at startup.
 */
'use strict';
const dns = require('node:dns').promises;
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const ipaddr = require('ipaddr.js');
const fetch = require('node-fetch');
const robotsParser = require('robots-parser');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const config = require('../../config/ntb-government-sources.json');

const USER_AGENT = 'LokalNewsHub/1.0 (public source discovery)';
const AGENT_NAME = 'LokalNewsHub';
const MAX_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const robotCache = new Map();

function rootFor(host) {
  const parts = host.toLowerCase().split('.');
  if (parts.length < 3 || parts.at(-2) !== 'go' || parts.at(-1) !== 'id') return null;
  return parts.slice(-3).join('.');
}
function validGovernmentUrl(raw, root) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) throw new Error('URL_TIDAK_DIIZINKAN');
  const host = u.hostname.toLowerCase();
  if (!root || !(host === root || host.endsWith('.' + root))) throw new Error('DOMAIN_DI_LUAR_SUMBER');
  return u;
}
async function dnsAnswers(host) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), 8000);
    timer.unref();
  });
  const answers = await Promise.race([dns.lookup(host, { all: true, verbatim: true }), timeout]);
  if (!answers.length || answers.some(({ address }) => {
    try { return ipaddr.process(address).range() !== 'unicast'; } catch { return true; }
  })) throw new Error('IP_NONPUBLIK_DIBLOKIR');
  return answers;
}
async function requestOnce(raw, root) {
  const u = validGovernmentUrl(raw, root);
  const addresses = await dnsAnswers(u.hostname);
  const selected = addresses[0];
  const agent = new https.Agent({
    lookup(host, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (host.toLowerCase() !== u.hostname.toLowerCase()) return callback(new Error('HOST_TIDAK_SESUAI'));
      if (options && options.all) return callback(null, [selected]);
      return callback(null, selected.address, selected.family);
    }
  });
  let response;
  try {
    response = await fetch(u.href, {
      method: 'GET', redirect: 'manual', timeout: REQUEST_TIMEOUT_MS, size: MAX_BYTES, agent,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/rss+xml,application/atom+xml,application/xml,text/plain;q=0.9,*/*;q=0.1' }
    });
    const result = {
      status: response.status,
      contentType: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
      location: response.headers.get('location') || null,
      body: ''
    };
    if (response.status >= 300 && response.status < 400) {
      response.body?.destroy();
      return result;
    }
    // Read no more than the node-fetch size limit. Never persist raw HTML or full article text.
    result.body = await response.text();
    return result;
  } finally {
    if (response?.body && !response.body.destroyed) response.body.destroy();
    agent.destroy();
  }
}
function errorCode(error) {
  const allowed = ['URL_TIDAK_DIIZINKAN','DOMAIN_DI_LUAR_SUMBER','DNS_TIMEOUT','IP_NONPUBLIK_DIBLOKIR','HOST_TIDAK_SESUAI'];
  if (allowed.includes(error?.message)) return error.message;
  return String(error?.code || error?.type || error?.name || 'GAGAL').slice(0, 80);
}
async function fetchRobots(origin, root) {
  let current = new URL('/robots.txt', origin).href;
  try {
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const response = await requestOnce(current, root);
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) return { status: 'unknown', reason: 'REDIRECT_TANPA_LOKASI' };
        current = validGovernmentUrl(new URL(response.location, current).href, root).href;
        continue;
      }
      if (response.status === 404 || response.status === 410) return { status: 'absent', http: response.status };
      if (response.status === 401 || response.status === 403) return { status: 'blocked', http: response.status };
      if (response.status === 429) return { status: 'rate_limited', http: response.status };
      if (response.status !== 200) return { status: 'unknown', http: response.status };
      // A site sometimes returns its HTML home page for non-existent routes; that is not robots.txt.
      if (/text\/html|application\/xhtml/.test(response.contentType) && !/^\s*(user-agent|disallow|allow)\s*:/im.test(response.body)) {
        return { status: 'unknown', http: 200, reason: 'ROBOTS_MENGEMBALIKAN_HTML' };
      }
      return { status: 'available', http: 200, parser: robotsParser(new URL('/robots.txt', origin).href, response.body) };
    }
    return { status: 'unknown', reason: 'TERLALU_BANYAK_REDIRECT' };
  } catch (e) { return { status: 'unknown', reason: errorCode(e) }; }
}
async function policyFor(url, root) {
  const u = validGovernmentUrl(url, root);
  const key = u.origin;
  if (!robotCache.has(key)) robotCache.set(key, fetchRobots(key, root));
  const policy = await robotCache.get(key);
  if (policy.status === 'absent') return { allowed: true, robots: 'absent', http: policy.http, reason: 'robots.txt tidak ada; bukan bukti izin lisensi' };
  if (policy.status !== 'available') return { allowed: false, robots: policy.status, http: policy.http, reason: policy.reason || 'Kebijakan akses belum dapat dipastikan' };
  const allowed = policy.parser.isAllowed(u.href, AGENT_NAME) !== false;
  return { allowed, robots: 'available', http: policy.http, reason: allowed ? null : 'robots.txt melarang URL ini' };
}
async function getAllowed(raw, root) {
  let current = validGovernmentUrl(raw, root).href;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const policy = await policyFor(current, root);
    if (!policy.allowed) return { ok: false, url: current, policy, reason: 'ROBOTS_DITOLAK_ATAU_TIDAK_DIKETAHUI' };
    let response;
    try { response = await requestOnce(current, root); }
    catch (e) { return { ok: false, url: current, policy, reason: errorCode(e) }; }
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return { ok: false, url: current, policy, http: response.status, reason: 'REDIRECT_TANPA_LOKASI' };
      try { current = validGovernmentUrl(new URL(response.location, current).href, root).href; }
      catch (e) { return { ok: false, url: current, policy, http: response.status, reason: errorCode(e) }; }
      continue;
    }
    const gate = /just a moment|attention required|cf-chl-|captcha challenge/i.test(response.body.slice(0, 20_000));
    if (gate) return { ok: false, url: current, policy, http: response.status, reason: 'PERLINDUNGAN_OTOMATIS_TIDAK_DILEWATI' };
    return { ok: response.status === 200, url: current, policy, http: response.status, contentType: response.contentType, body: response.body };
  }
  return { ok: false, url: current, reason: 'TERLALU_BANYAK_REDIRECT' };
}
function clean(v, max = 180) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function htmlInfo(body, base, root) {
  const $ = cheerio.load(body);
  const title = clean($('title').first().text());
  const feedUrls = [];
  $('link[rel~="alternate"][href]').each((_, el) => {
    const type = String($(el).attr('type') || '').toLowerCase();
    if (!/(rss|atom|xml)/.test(type)) return;
    try { const u = validGovernmentUrl(new URL($(el).attr('href'), base).href, root); if (!feedUrls.includes(u.href)) feedUrls.push(u.href); } catch {}
  });
  const candidates = [], nav = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const text = clean($(el).text());
    let u;
    try { u = validGovernmentUrl(new URL($(el).attr('href'), base).href, root); } catch { return; }
    const key = u.href;
    if (!seen.has(key) && text.length >= 18 && !/^(berita terbaru|baca selengkapnya|selengkapnya|lihat semua|semua berita|next|previous|read more)$/i.test(text) && /(?:\/post\/[^/]+|\/artikel\/[^/]+|\/berita\/(?:detail\/)?[^/]+|\/news\/[^/]+|\/detail-berita\/[^/]+|option=com_content.*view=article|view=article.*option=com_content)/i.test(u.pathname + u.search)) {
      candidates.push({ title: text, url: key }); seen.add(key);
    }
    if (/^(berita|berita terbaru|semua berita|news|artikel|artikel terkini)$/i.test(text) && /(?:news|berita|artikel)/i.test(u.pathname) && !nav.includes(key)) nav.push(key);
  });
  return { title, advertisedFeeds: feedUrls.slice(0, 3), candidateLinks: candidates.slice(0, 5), candidateCountAtLeast: candidates.length, navigationListings: nav.slice(0, 3), timeTags: $('time[datetime]').length };
}
async function checkFeed(url, root) {
  const r = await getAllowed(url, root);
  if (!r.ok) return { url: r.url, robots: r.policy?.robots || null, http: r.http || null, ok: false, reason: r.reason || 'HTTP_GAGAL' };
  try {
    if (/^\s*<!doctype\s+html|^\s*<html/i.test(r.body)) throw new Error('BUKAN_RSS_ATOM');
    const parser = new Parser({ timeout: REQUEST_TIMEOUT_MS });
    const feed = await parser.parseString(r.body);
    if (!Array.isArray(feed.items)) throw new Error('BUKAN_RSS_ATOM');
    return { url: r.url, robots: r.policy?.robots || null, http: r.http, ok: true, itemCount: feed.items.length, sample: feed.items.slice(0, 3).map(x => ({ title: clean(x.title), sourceDateRaw: clean(x.pubDate || x.isoDate || '', 100) || null })) };
  } catch { return { url: r.url, robots: r.policy?.robots || null, http: r.http, ok: false, reason: 'BUKAN_RSS_ATOM_VALID' }; }
}
async function inspect(source) {
  const root = rootFor(new URL(source.requestedUrl).hostname);
  const result = { id: source.id, name: source.name, requestedUrl: source.requestedUrl, checkedAt: new Date().toISOString(), rightsStatus: 'not_verified', active: false };
  const listing = await getAllowed(source.requestedUrl, root);
  result.robots = listing.policy || null;
  result.page = { url: listing.url, http: listing.http || null, ok: listing.ok, contentType: listing.contentType || null, reason: listing.reason || null };
  if (!listing.ok || !/html|xhtml/.test(listing.contentType || '')) return result;
  const info = htmlInfo(listing.body, listing.url, root);
  result.page.title = info.title;
  result.page.candidateCountAtLeast = info.candidateCountAtLeast;
  result.page.candidateLinks = info.candidateLinks;
  result.page.timeTags = info.timeTags;
  result.advertisedFeeds = info.advertisedFeeds;
  result.listingCandidate = null;
  // Only if the supplied URL is a homepage and it advertises a named news listing.
  const u = new URL(listing.url);
  if (u.pathname === '/' && info.navigationListings.length) {
    const url = info.navigationListings.find(x => x !== listing.url);
    if (url) {
      const linked = await getAllowed(url, root);
      result.listingCandidate = { url: linked.url, http: linked.http || null, ok: linked.ok, reason: linked.reason || null };
      if (linked.ok && /html|xhtml/.test(linked.contentType || '')) {
        const parsed = htmlInfo(linked.body, linked.url, root);
        Object.assign(result.listingCandidate, { title: parsed.title, candidateCountAtLeast: parsed.candidateCountAtLeast, candidateLinks: parsed.candidateLinks, timeTags: parsed.timeTags });
        for (const feed of parsed.advertisedFeeds) if (!result.advertisedFeeds.includes(feed)) result.advertisedFeeds.push(feed);
      }
    }
  }
  // Test at most one advertised feed per source, subject to that URL's robots policy.
  result.feed = result.advertisedFeeds.length ? await checkFeed(result.advertisedFeeds[0], root) : null;
  return result;
}
async function main() {
  if (!Array.isArray(config.items) || config.items.length !== 11) throw new Error('Daftar sumber tidak lengkap');
  const results = new Array(config.items.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < config.items.length) {
      const i = next++;
      try { results[i] = await inspect(config.items[i]); }
      catch (e) { results[i] = { id: config.items[i].id, name: config.items[i].name, requestedUrl: config.items[i].requestedUrl, checkedAt: new Date().toISOString(), active: false, rightsStatus: 'not_verified', error: errorCode(e) }; }
    }
  }));
  const output = { checkedAt: new Date().toISOString(), purpose: 'Single bounded read-only source discovery. No article page, publication, scheduler, DB or provider changes.', results };
  const out = process.argv[2] || '/home/user/preview-audit/official-ntb-source-check.json';
  const resolved = path.resolve(out);
  if (!resolved.startsWith('/home/user/')) throw new Error('Output harus di workspace');
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(output, null, 2), { mode: 0o600 });
  for (const r of results) console.log([r.name, 'robots='+String(r.robots?.robots || '?'), 'page='+String(r.page?.http || r.page?.reason || r.error || '?'), 'links='+String(r.page?.candidateCountAtLeast ?? '-'), 'feed='+String(r.feed?.ok ? 'valid ('+r.feed.itemCount+' items)' : (r.feed?.reason || 'belum terbukti'))].join(' | '));
  console.log('Report:', resolved);
}
if (require.main === module) main().catch(e => { console.error('Pemeriksaan gagal:', errorCode(e)); process.exitCode = 1; });
module.exports = { rootFor, validGovernmentUrl, htmlInfo };
