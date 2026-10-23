import { HttpError } from "../../errors.js";

const BLOCKING_RELATION_CYCLE_MESSAGE = "Blocking relations cannot contain cycles";

export function isBlockingRelationCycleError(error: unknown): boolean {
  return error instanceof HttpError &&
    error.status === 422 &&
    error.message === BLOCKING_RELATION_CYCLE_MESSAGE;
}
