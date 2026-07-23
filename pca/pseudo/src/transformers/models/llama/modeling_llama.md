## LlamaRMSNorm.__init__

BEHAVIOR:

1. Call super().__init__() to init the nn.Module.
2. Create self.weight as a trainable nn.Parameter of torch.ones(hidden_size).
3. Store eps as self.variance_epsilon.

## LlamaRMSNorm.forward

BEHAVIOR:

1. Remember the input dtype of hidden_states.
2. Upcast hidden_states to float32.
3. Compute variance = mean(x^2, over last dim, keepdim=True).
4. Scale hidden_states by rsqrt(variance + self.variance_epsilon).
5. Cast back to the remembered input dtype.
6. Return self.weight * normalized.

## LlamaRMSNorm.extra_repr

BEHAVIOR:

1. Return the string f"{self.weight.shape}, eps={self.variance_epsilon}".

## LlamaRotaryEmbedding.__init__

BEHAVIOR:

1. Cache max_seq_len_cached and original_max_seq_len from config.max_position_embeddings.
2. Read rope_type from config.rope_parameters["rope_type"].
3. Pick rope_init_fn = self.compute_default_rope_parameters if rope_type == "default",
   else ROPE_INIT_FUNCTIONS[rope_type].
4. Call rope_init_fn(config, device) to get (inv_freq, attention_scaling).
5. register_buffer "inv_freq" (non-persistent).
6. register_buffer "original_inv_freq" as a clone of inv_freq (non-persistent).

## LlamaRotaryEmbedding.compute_default_rope_parameters

BEHAVIOR:

1. base = config.rope_parameters["rope_theta"].
2. dim = config.head_dim or (config.hidden_size // config.num_attention_heads).
3. Compute inv_freq = 1.0 / (base ** (arange(0, dim, 2, dtype=int64).float() / dim)).
4. attention_factor = 1.0 (unused for default rope).
5. Return (inv_freq, attention_factor).

## LlamaRotaryEmbedding.forward

BEHAVIOR:

1. Expand inv_freq to (batch, -1, 1) as float32, moved to x.device.
2. Expand position_ids to (1, seq_len) as float32.
3. Pick device_type = x.device.type unless it is "mps", else "cpu".
4. Under maybe_autocast(device_type, enabled=False) (force float32):
   a. freqs = (inv_freq @ position_ids).transpose(1, 2).
   b. emb = cat(freqs, freqs) along the last dim.
   c. cos = emb.cos() *self.attention_scaling.
   d. sin = emb.sin()* self.attention_scaling.
5. Cast cos and sin back to x.dtype.
6. Return (cos, sin).
Note: @dynamic_rope_update may refresh inv_freq before the body for advanced
rope types.

## rotate_half

BEHAVIOR:

1. Split the last dim in half: x1 = x[..., :D/2], x2 = x[..., D/2:].
2. Return cat((-x2, x1), dim=-1).

## apply_rotary_pos_emb

BEHAVIOR:

1. Unsqueeze cos and sin on unsqueeze_dim (default 1).
2. q_embed = q *cos + rotate_half(q)* sin.
3. k_embed = k *cos + rotate_half(k)* sin.
4. Return (q_embed, k_embed).
Note: a hub kernel may replace this function at runtime.

## LlamaMLP.__init__

BEHAVIOR:

1. Store hidden_size and intermediate_size from config.
2. gate_proj = Linear(hidden -> intermediate, bias=config.mlp_bias).
3. up_proj = Linear(hidden -> intermediate, bias=config.mlp_bias).
4. down_proj = Linear(intermediate -> hidden, bias=config.mlp_bias).
5. act_fn = ACT2FN[config.hidden_act].

## LlamaMLP.forward

BEHAVIOR:

1. gate = self.act_fn(self.gate_proj(x)).
2. up = self.up_proj(x).
3. Return self.down_proj(gate * up).

## repeat_kv

BEHAVIOR:

1. Read shape (batch, num_key_value_heads, slen, head_dim) and n_rep.
2. If n_rep == 1, return hidden_states unchanged.
3. Expand to (batch, num_key_value_heads, n_rep, slen, head_dim).
4. Reshape to (batch, num_key_value_heads * n_rep, slen, head_dim).
5. Return the reshaped tensor.

## eager_attention_forward

BEHAVIOR:

1. key_states = repeat_kv(key, module.num_key_value_groups).
2. value_states = repeat_kv(value, module.num_key_value_groups).
3. attn_weights = matmul(query, key_states.transpose(2, 3)) * scaling.
4. If attention_mask is not None, attn_weights += attention_mask.
5. attn_weights = softmax(attn_weights, dim=-1, dtype=float32).to(query.dtype).
6. attn_weights = dropout(attn_weights, p=dropout, training=module.training).
7. attn_output = matmul(attn_weights, value_states).
8. attn_output = attn_output.transpose(1, 2).contiguous().
9. Return (attn_output, attn_weights).

## LlamaAttention.__init__

BEHAVIOR:

1. head_dim = config.head_dim or (config.hidden_size // config.num_attention_heads).
2. num_key_value_groups = config.num_attention_heads // config.num_key_value_heads.
3. scaling = head_dim ** -0.5.
4. Store attention_dropout and is_causal = True.
5. q_proj = Linear(hidden -> num_attention_heads * head_dim, bias=config.attention_bias).
6. k_proj = Linear(hidden -> num_key_value_heads * head_dim, bias=config.attention_bias).
7. v_proj = Linear(hidden -> num_key_value_heads * head_dim, bias=config.attention_bias).
8. o_proj = Linear(num_attention_heads * head_dim -> hidden, bias=config.attention_bias).

## LlamaAttention.forward

BEHAVIOR:

1. Reshape hidden_states to (*batch_seq, -1, head_dim) and transpose to (batch, heads, seq, head_dim) for q, k, v via q_proj/k_proj/v_proj.
2. Unpack (cos, sin) from position_embeddings.
3. Apply rotary: query_states, key_states = apply_rotary_pos_emb(q, k, cos, sin).
4. If past_key_values is not None, update it at self.layer_idx with (key_states, value_states).
5. Pick attention_interface = ALL_ATTENTION_FUNCTIONS.get_interface(config._attn_implementation, eager_attention_forward).
6. Call attention_interface(self, query_states, key_states, value_states, attention_mask, dropout=(0.0 if not training else self.attention_dropout), scaling=self.scaling, **kwargs) -> (attn_output, attn_weights).
7. Reshape attn_output back to (*batch_seq, -1) and make contiguous.
8. Return self.o_proj(attn_output) and attn_weights.

## LlamaDecoderLayer.__init__

BEHAVIOR:

1. self_attn = LlamaAttention(config, layer_idx).
2. mlp = LlamaMLP(config).
3. input_layernorm = LlamaRMSNorm(hidden_size, eps=config.rms_norm_eps).
4. post_attention_layernorm = LlamaRMSNorm(hidden_size, eps=config.rms_norm_eps).

## LlamaDecoderLayer.forward

BEHAVIOR:

1. residual = hidden_states.
2. h = self.input_layernorm(hidden_states).
3. h, _= self.self_attn(hidden_states=h, attention_mask, position_ids, past_key_values, use_cache, position_embeddings, **kwargs).
4. hidden_states = residual + h.
5. residual = hidden_states.
6. h = self.post_attention_layernorm(hidden_states).
7. h = self.mlp(h).
8. Return residual + h.

## LlamaModel.__init__

BEHAVIOR:

1. super().__init__(config).
2. Store padding_idx and vocab_size from config.
3. embed_tokens = nn.Embedding(vocab_size, hidden_size, padding_idx).
4. layers = nn.ModuleList of LlamaDecoderLayer(config, layer_idx) for layer_idx in range(num_hidden_layers).
5. norm = LlamaRMSNorm(hidden_size, eps=config.rms_norm_eps).
6. rotary_emb = LlamaRotaryEmbedding(config).
7. gradient_checkpointing = False.
8. Call self.post_init() (weight init + checkpointing defaults).

## LlamaModel.forward

BEHAVIOR:

1. Assert exactly one of input_ids / inputs_embeds is set (XOR), else raise ValueError.
2. If inputs_embeds is None, inputs_embeds = self.embed_tokens(input_ids).
3. If use_cache and past_key_values is None, past_key_values = DynamicCache(config=self.config).
4. If position_ids is None, derive it: past_seen_tokens = past_key_values.get_seq_length() if present else 0; position_ids = arange(seq_len, device) + past_seen_tokens; unsqueeze(0).
5. causal_mask = create_causal_mask(config, inputs_embeds, attention_mask, past_key_values, position_ids).
6. position_embeddings = self.rotary_emb(hidden_states, position_ids=position_ids) -> (cos, sin).
7. For each decoder_layer in self.layers[:config.num_hidden_layers]:
   hidden_states = decoder_layer(hidden_states, attention_mask=causal_mask, position_embeddings, position_ids, past_key_values, use_cache, **kwargs).
8. hidden_states = self.norm(hidden_states).
9. Return BaseModelOutputWithPast(last_hidden_state=hidden_states, past_key_values=past_key_values).

## LlamaForCausalLM.__init__

BEHAVIOR:

1. super().__init__(config).
2. self.model = LlamaModel(config).
3. vocab_size = config.vocab_size.
4. lm_head = nn.Linear(hidden_size, vocab_size, bias=False).
5. Call self.post_init() (handles weight tying via_tied_weights_keys: lm_head.weight <- model.embed_tokens.weight).

## LlamaForCausalLM.forward

BEHAVIOR:

1. outputs = self.model(input_ids, attention_mask, position_ids, past_key_values, inputs_embeds, use_cache, **kwargs).
2. hidden_states = outputs.last_hidden_state.
3. slice_indices = slice(-logits_to_keep, None) if logits_to_keep is an int else logits_to_keep.
4. logits = self.lm_head(hidden_states[:, slice_indices, :]).
5. If labels is not None: loss = self.loss_function(logits=logits, labels=labels, vocab_size=self.config.vocab_size, **kwargs); else loss = None.
6. Return CausalLMOutputWithPast(loss, logits, past_key_values=outputs.past_key_values, hidden_states=outputs.hidden_states, attentions=outputs.attentions).
