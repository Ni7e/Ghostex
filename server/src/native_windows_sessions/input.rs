#[derive(Default)]
pub(crate) struct InputFilter {
    pending: Vec<u8>,
}

impl InputFilter {
    pub fn feed(&mut self, bytes: &[u8]) -> (Vec<u8>, Vec<(u16, u16)>) {
        const PREFIX: &[u8] = b"\x1b]1337;ZMX_";
        self.pending.extend_from_slice(bytes);
        let mut output = Vec::new();
        let mut sizes = Vec::new();
        while !self.pending.is_empty() {
            if PREFIX.starts_with(&self.pending) {
                break;
            }
            if self.pending.starts_with(PREFIX) {
                if let Some(end) = self.pending.iter().position(|byte| *byte == 7) {
                    let control = String::from_utf8_lossy(&self.pending[PREFIX.len()..end]);
                    if let Some(dimensions) = control
                        .strip_prefix("VISIBLE=")
                        .or_else(|| control.strip_prefix("CHAT="))
                    {
                        if let Some((rows, cols)) = dimensions.split_once(',') {
                            if let (Ok(rows), Ok(cols)) = (rows.parse::<u16>(), cols.parse::<u16>())
                            {
                                if (1..=2000).contains(&rows) && (1..=2000).contains(&cols) {
                                    sizes.push((rows, cols));
                                }
                            }
                        }
                    }
                    self.pending.drain(..=end);
                    continue;
                }
                if self.pending.len() < 128 {
                    break;
                }
            }
            output.push(self.pending.remove(0));
        }
        (output, sizes)
    }

    pub fn flush(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }
}
