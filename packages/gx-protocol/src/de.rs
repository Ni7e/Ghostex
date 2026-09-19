//! Null-tolerant field deserializers.
//!
//! gxserver copies some row values onto the wire verbatim, so a key that is normally a bool or a
//! list can arrive as `null` from an older row. These helpers read `null` as the type's default
//! instead of failing the whole frame. They are for keys the protocol survey documents as loose;
//! a wrong type (a string where a bool belongs) still fails.

use serde::{Deserialize, Deserializer};

/// Reads `null` as `T::default()`. Pair with `#[serde(default)]` so an absent key does the same.
pub fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}
