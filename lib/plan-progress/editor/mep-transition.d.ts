import type { ProgressDocument } from '../core';
export function hasMepBuilding(value: unknown): boolean;
export function canCloseMepBlocker(blocker: {status?:string} | null | undefined): boolean;
export function mepTransitionProblem(previous: Pick<ProgressDocument,'elements'>,next: Pick<ProgressDocument,'elements'>,context?: {requireBuilding?:boolean;building?:string}): string;
