use serde::{Deserialize, Serialize};

pub type Tick = i64;

pub const V1_TICKS_PER_SECOND: u32 = 240_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timebase {
    pub ticks_per_second: u32,
}

impl Default for Timebase {
    fn default() -> Self {
        Self {
            ticks_per_second: V1_TICKS_PER_SECOND,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimelineTime {
    pub tick: Tick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameRate {
    pub num: u32,
    pub den: u32,
}

pub fn tick_to_seconds_f64(tick: Tick, timebase: Timebase) -> f64 {
    tick as f64 / f64::from(timebase.ticks_per_second)
}

pub fn seconds_to_tick(seconds: f64, timebase: Timebase) -> Tick {
    (seconds * f64::from(timebase.ticks_per_second)).round() as Tick
}

pub fn frame_to_tick(frame: i64, frame_rate: FrameRate, timebase: Timebase) -> Tick {
    let numerator = i128::from(frame)
        * i128::from(timebase.ticks_per_second)
        * i128::from(frame_rate.den);
    let denominator = i128::from(frame_rate.num);
    // Round half away from zero for deterministic mapping.
    if numerator >= 0 {
        ((numerator + denominator / 2) / denominator) as Tick
    } else {
        ((numerator - denominator / 2) / denominator) as Tick
    }
}

pub fn tick_to_frame_floor(tick: Tick, frame_rate: FrameRate, timebase: Timebase) -> i64 {
    let numerator = i128::from(tick) * i128::from(frame_rate.num);
    let denominator = i128::from(timebase.ticks_per_second) * i128::from(frame_rate.den);
    (numerator.div_euclid(denominator)) as i64
}

pub fn tick_to_frame_round(tick: Tick, frame_rate: FrameRate, timebase: Timebase) -> i64 {
    let numerator = i128::from(tick) * i128::from(frame_rate.num);
    let denominator = i128::from(timebase.ticks_per_second) * i128::from(frame_rate.den);
    if numerator >= 0 {
        ((numerator + denominator / 2) / denominator) as i64
    } else {
        ((numerator - denominator / 2) / denominator) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::{frame_to_tick, tick_to_frame_floor, tick_to_frame_round, FrameRate, Timebase};

    #[test]
    fn converts_common_frame_rates_consistently() {
        let timebase = Timebase::default();
        let frame_rates = [
            FrameRate { num: 24_000, den: 1_001 }, // 23.976
            FrameRate { num: 24, den: 1 },
            FrameRate { num: 25, den: 1 },
            FrameRate { num: 30_000, den: 1_001 }, // 29.97
            FrameRate { num: 30, den: 1 },
            FrameRate { num: 60_000, den: 1_001 }, // 59.94
            FrameRate { num: 60, den: 1 },
        ];

        for frame_rate in frame_rates {
            let frame = 1_000;
            let tick = frame_to_tick(frame, frame_rate, timebase);
            let round_trip_rounded = tick_to_frame_round(tick, frame_rate, timebase);
            let round_trip_floor = tick_to_frame_floor(tick, frame_rate, timebase);

            assert!(round_trip_rounded == frame || round_trip_rounded == frame - 1);
            assert!(round_trip_floor <= frame);
        }
    }
}
