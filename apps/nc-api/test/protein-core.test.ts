import { describe, expect, it } from 'vitest';
import * as core from '../../../packages/protein-core/index';
import vectorsFile from '../../../packages/protein-core/vectors.json';

type Vector = Record<string, any>;
const vectors = vectorsFile as unknown as {
  calculate: Vector[];
  chooseTarget: Vector[];
  contribution: Vector[];
  intake: Vector[];
  progress: Vector[];
  costPer25: Vector[];
  targetOnDate: Vector[];
};
const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 8);

describe('shared protein-core vectors', () => {
  it('calculates cited protein guidance', () => {
    for (const vector of vectors.calculate) {
      const result = core.calculate(vector.value, vector.unit, vector.category);
      close(result.low, vector.low);
      close(result.high, vector.high);
      close(result.kg, vector.kg);
    }
  });

  it('validates target choices', () => {
    for (const vector of vectors.chooseTarget) {
      const action = () => core.chooseTarget(vector.guidance, vector.grams, vector.mode);
      if (vector.valid) expect(action, vector.name).not.toThrow();
      else expect(action, vector.name).toThrow();
    }
  });

  it('calculates contribution, preserving unknowns and invalid portions', () => {
    for (const vector of vectors.contribution) {
      const action = () => core.contribution(vector.protein, vector.reference, vector.grams);
      if (vector.throws) expect(action, vector.name).toThrow();
      else expect(action(), vector.name).toBe(vector.result);
    }
  });

  it('calculates intake and counts unknown entries', () => {
    for (const vector of vectors.intake) {
      const result = core.intake(vector.entries as Parameters<typeof core.intake>[0]);
      close(result.grams, vector.grams);
      expect(result.unknown).toBe(vector.unknown);
    }
  });

  it('calculates progress, cost, and target history', () => {
    for (const vector of vectors.progress) {
      const result = core.progress(vector.total, vector.target);
      expect(result.remaining).toBe(vector.remaining);
      close(result.fraction, vector.fraction);
    }
    for (const vector of vectors.costPer25) {
      expect(core.costPer25(vector.price, vector.packageGrams, vector.proteinPer100), vector.name).toBe(vector.result);
    }
    for (const vector of vectors.targetOnDate) {
      expect(core.targetOnDate(vector.events as Parameters<typeof core.targetOnDate>[0], vector.date), vector.name).toEqual(vector.result);
    }
  });
});
