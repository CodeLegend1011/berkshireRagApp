// src/agents/philosophy-lens-agent.ts
/**
 * Philosophy Lens Agent
 *
 * - Clusters embeddings to discover recurring "tones" or "themes" in Buffett's letters.
 * - Assigns cluster names and descriptions.
 * - Exposes analyzeChunks(...) which returns a mapping of chunk_id -> cluster.
 * - Implements Retriever interface for RAGAgent compatibility.
 */

import { getVectorDim, query } from "../config/database";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../config/mastra";
import type { Retriever, RetrieverResult } from "./rag-agent";

type ChunkWithEmbedding = {
  chunk_id: string;
  embedding: number[];
  text?: string;
  metadata?: Record<string, any>;
};

type Cluster = {
  id: string;
  name: string;
  centroid: number[];
  members: string[];
  description?: string;
};

/**
 * Euclidean distance between two vectors
 */
function l2(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Simple k-means++ initialization
 */
function kmeansPlusPlusInit(points: number[][], k: number): number[] {
  const n = points.length;
  if (k >= n) return Array.from({ length: n }, (_, i) => i);

  const centers: number[] = [];
  centers.push(Math.floor(Math.random() * n));
  const distances = new Array(n).fill(Infinity);

  while (centers.length < k) {
    for (let i = 0; i < n; i++) {
      const d = l2(points[i], points[centers[centers.length - 1]]);
      if (d < distances[i]) distances[i] = d;
    }
    const weighted = distances.map((d) => d * d);
    const total = weighted.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let next = 0;
    for (let i = 0; i < n; i++) {
      r -= weighted[i];
      if (r <= 0) {
        next = i;
        break;
      }
    }
    centers.push(next);
  }
  return centers;
}

/**
 * Run k-means clustering (small-scale)
 */
function kmeans(points: number[][], k = 5, maxIters = 100): { centroids: number[][]; labels: number[] } {
  const n = points.length;
  if (n === 0) return { centroids: [], labels: [] };
  const dim = points[0].length;

  let centersIdx = kmeansPlusPlusInit(points, k);
  let centroids = centersIdx.map((i) => [...points[i]]);
  let labels = new Array(n).fill(0);

  for (let it = 0; it < maxIters; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = l2(points[i], centroids[0]);
      for (let c = 1; c < centroids.length; c++) {
        const d = l2(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    const sums = Array.from({ length: centroids.length }, () => new Array(dim).fill(0));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      counts[c] += 1;
      for (let d = 0; d < dim; d++) sums[c][d] += points[i][d];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c];
    }
    if (!changed) break;
  }

  return { centroids, labels };
}

/**
 * Generate a short name for a cluster from its member texts
 */
function labelCluster(idx: number, membersText: string[]): string {
  const freq: Record<string, number> = {};
  for (const t of membersText.slice(0, 20)) {
    const tokens = t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((s) => s.length > 3 && s.length < 20);
    for (const tok of tokens) freq[tok] = (freq[tok] || 0) + 1;
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map((p) => p[0]);
  if (top.length) return `Cluster ${idx + 1} — ${top.join(", ")}`;
  return `Cluster ${idx + 1}`;
}

export class PhilosophyLensAgent implements Retriever {
  clusterCount: number;
  chunks: ChunkWithEmbedding[] = []; // store processed chunks

  constructor(clusterCount = 5) {
    this.clusterCount = clusterCount;
  }

  async analyzeChunks(chunks: ChunkWithEmbedding[], persist = true): Promise<{ clusters: Cluster[]; assignment: Record<string, string> }> {
    if (!chunks || chunks.length === 0) return { clusters: [], assignment: {} };
    this.chunks = chunks; // store for retrieval

    const dim = getVectorDim();
    const points = chunks.map((c) => c.embedding.slice(0, dim));

    const { centroids, labels } = kmeans(points, this.clusterCount);

    const clustersMap: Record<number, Cluster> = {};
    for (let i = 0; i < centroids.length; i++) {
      clustersMap[i] = { id: uuidv4(), name: `Cluster ${i + 1}`, centroid: centroids[i], members: [] };
    }

    const assignment: Record<string, string> = {};
    for (let i = 0; i < chunks.length; i++) {
      const label = labels[i];
      clustersMap[label].members.push(chunks[i].chunk_id);
      assignment[chunks[i].chunk_id] = clustersMap[label].id;
    }

    const clusters: Cluster[] = [];
    for (const key of Object.keys(clustersMap)) {
      const idx = Number(key);
      const c = clustersMap[idx];
      const membersText = c.members.map((mId) => chunks.find((x) => x.chunk_id === mId)?.text || "").filter(Boolean);
      c.name = labelCluster(idx, membersText);
      c.description = `${c.members.length} chunks — representative of ${c.name}`;
      clusters.push(c);
    }

    return { clusters, assignment };
  }

  async interpretTone(text: string) {
    const lower = text.toLowerCase();
    const indicators: Record<string, number> = {};
    if (lower.includes("long-term") || lower.includes("long term") || lower.includes("patient")) indicators["patient"] = 1;
    if (lower.includes("margin of safety")) indicators["safety-focused"] = 1;
    if (lower.includes("intrinsic value") || lower.includes("valuation")) indicators["valuation-driven"] = 1;
    if (lower.includes("shareholder") || lower.includes("owner")) indicators["shareholder-oriented"] = 1;
    if (lower.includes("opportunity") || lower.includes("purchase")) indicators["opportunistic"] = 1;

    const found = Object.keys(indicators);
    if (found.length === 0) return { tone: "neutral", factors: [] };
    return { tone: found.join(", "), factors: found };
  }

  // ✅ Implement Retriever interface
  async retrieve(query: string, options?: { topK?: number }): Promise<RetrieverResult[]> {
    const topK = options?.topK || 5;
    const results: RetrieverResult[] = this.chunks
      .filter((c) => c.text?.toLowerCase().includes(query.toLowerCase()))
      .slice(0, topK)
      .map((c, idx) => ({
        chunk_id: c.chunk_id,
        document_id: c.chunk_id,
        text: c.text || "",
        metadata: c.metadata,
        score: 1.0 / (idx + 1),
      }));
    return results;
  }
}

export default PhilosophyLensAgent;
