// A route drawn as a line of stops, left to right in driving order.
// Shows where the car is and, for a passenger, the part of the route they ride.

type Props = {
  stops: string[];
  // The stop the car is at or heading to; leave out to hide the car.
  carStop?: number;
  carAtStop?: boolean;
  // A passenger's part of the route: from pickup to drop-off.
  from?: number;
  to?: number;
  // A short note under a stop, e.g. "1 gets on".
  notes?: Record<number, string>;
};

export function RouteLine({
  stops,
  carStop,
  carAtStop = false,
  from,
  to,
  notes = {},
}: Props) {
  const ridden = (index: number) =>
    from !== undefined && to !== undefined && index >= from && index <= to;
  // The line between stop index and index + 1 is part of the ride.
  const riddenAfter = (index: number) =>
    from !== undefined && to !== undefined && index >= from && index < to;

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex">
        {stops.map((name, index) => {
          const carHere = carStop === index && carAtStop;
          const carComing = carStop === index && !carAtStop;
          return (
            <li key={name} className="relative min-w-[4.5rem] flex-1">
              <div className="relative flex h-6 items-center">
                {/* line to the previous and to the next stop */}
                {index > 0 && (
                  <span
                    className={`absolute left-0 right-1/2 h-0.5 ${riddenAfter(index - 1) ? "bg-stone-900" : "bg-stone-200"}`}
                  />
                )}
                {index < stops.length - 1 && (
                  <span
                    className={`absolute left-1/2 right-0 h-0.5 ${riddenAfter(index) ? "bg-stone-900" : "bg-stone-200"}`}
                  />
                )}
                {/* the stop itself */}
                <span className="relative mx-auto flex items-center justify-center">
                  {carHere ? (
                    <CarMarker />
                  ) : (
                    <span
                      className={`h-3 w-3 rounded-full border-2 ${
                        ridden(index)
                          ? "border-stone-900 bg-stone-900"
                          : "border-stone-300 bg-paper"
                      }`}
                    />
                  )}
                </span>
                {/* the car between the previous stop and this one */}
                {carComing && (
                  <span className="absolute left-0 -translate-x-1/2">
                    <CarMarker moving />
                  </span>
                )}
              </div>
              <p
                className={`mt-2 px-1 text-center text-xs leading-tight ${
                  ridden(index) || carHere
                    ? "font-medium text-stone-900"
                    : "text-stone-500"
                }`}
              >
                {name}
              </p>
              {notes[index] && (
                <p className="mt-0.5 px-1 text-center text-[11px] leading-tight text-stone-500">
                  {notes[index]}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A small car badge: solid when standing at a stop, outlined while driving. */
function CarMarker({ moving = false }: { moving?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-emerald-100 ${
        moving
          ? "border border-emerald-600 bg-paper text-emerald-700"
          : "bg-emerald-600 text-white"
      }`}
      aria-label={moving ? "Car on the way" : "Car at this stop"}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
        <path d="M3.2 6.4 4.3 3.7A1.5 1.5 0 0 1 5.7 2.8h4.6a1.5 1.5 0 0 1 1.4.9l1.1 2.7A1.5 1.5 0 0 1 14 7.9v3.3a.8.8 0 0 1-.8.8h-.7a1.6 1.6 0 0 1-3.1 0H6.6a1.6 1.6 0 0 1-3.1 0h-.7a.8.8 0 0 1-.8-.8V7.9a1.5 1.5 0 0 1 1.2-1.5Zm1.4-.1h6.8l-.8-2a.5.5 0 0 0-.5-.3H5.9a.5.5 0 0 0-.5.3l-.8 2Z" />
      </svg>
    </span>
  );
}
