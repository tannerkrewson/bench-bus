import { createContext, useContext, type JSX } from "solid-js";
import { createTimeTravelValue, type TimeTravelContextValue, type TimeTravelProviderProps } from "./timeTravel";

const TimeTravelContext = createContext<TimeTravelContextValue>();

/** Provider holding the shared historical point-in-time selection. */
export function TimeTravelProvider(props: TimeTravelProviderProps): JSX.Element {
  const value = createTimeTravelValue(props);
  return <TimeTravelContext.Provider value={value}>{props.children}</TimeTravelContext.Provider>;
}

/** Access the shared time-travel state. Must be used inside TimeTravelProvider. */
export function useTimeTravel(): TimeTravelContextValue {
  const value = useContext(TimeTravelContext);
  if (!value) {
    throw new Error("useTimeTravel must be used within a TimeTravelProvider");
  }
  return value;
}
