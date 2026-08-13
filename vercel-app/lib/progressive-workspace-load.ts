export type ProgressiveLoadLease = {
  isCurrent: () => boolean;
};

/**
 * Publishes one dataset as soon as it is ready while keeping the original
 * promise available for the final, consistent workspace snapshot.
 */
export function publishWhenCurrent<T>(
  promise: Promise<T>,
  lease: ProgressiveLoadLease,
  publish: (value: T) => void,
): Promise<T> {
  void promise.then(value => {
    if (lease.isCurrent()) publish(value);
  }, () => {
    // The caller awaits the original promise and owns final error handling.
  });
  return promise;
}
