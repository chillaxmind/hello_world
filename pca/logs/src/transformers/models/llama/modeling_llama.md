# pca audit log — src/transformers/models/llama/modeling_llama.py

--- UNDERSTANDING 2026-07-23T19:36:43Z ---
### FN: LlamaRMSNorm.__init__
PURPOSE: Construct the RMS normalization layer with a learnable scale and a
variance epsilon.
DEPENDS_ON: torch.nn (nn.Module, nn.Parameter), torch.
BEHAVIOR: Call super().__init__(); create `self.weight` as a Parameter of
ones shaped (hidden_size,); store `eps` as `self.variance_epsilon`.
INVARIANTS: weight is a trainable Parameter of shape (hidden_size,); eps>0.
EDGE_CASES: hidden_size must be >0 (torch.ones raises otherwise).

### FN: LlamaRMSNorm.forward
PURPOSE: Root-mean-square normalize hidden states and re-scale by the
learnable weight, matching T5LayerNorm semantics.
DEPENDS_ON: torch (rsqrt, pow, mean).
BEHAVIOR: Remember input dtype; upcast to float32; compute
variance = mean(x^2, -1, keepdim); multiply by rsqrt(variance + eps);
cast back to input dtype; return weight * normalized.
INVARIANTS: Output dtype == input dtype; variance computed in float32 for
numerical stability; normalization is over the last dimension.
EDGE_CASES: The upcast/cast-back silently drops precision for float16/bf16
inputs (intended); zero variance is avoided by +eps.

### FN: LlamaRMSNorm.extra_repr
PURPOSE: Produce a human-readable representation for repr()/printing.
DEPENDS_ON: none.
BEHAVIOR: Return f"{weight.shape}, eps={variance_epsilon}".
INVARIANTS: Pure function, no side effects.
EDGE_CASES: none.

### FN: LlamaRotaryEmbedding.__init__
PURPOSE: Build the rotary embedding module: compute inverse frequencies for
the configured RoPE type and register them as non-persistent buffers.
DEPENDS_ON: LlamaConfig, ROPE_INIT_FUNCTIONS, torch.nn, self.compute_default_rope_parameters.
BEHAVIOR: Cache max_seq_len/original_max_seq_len from config; pick
rope_init_fn = compute_default_rope_parameters for "default" else
ROPE_INIT_FUNCTIONS[rope_type]; call it to get (inv_freq,
attention_scaling); register_buffer inv_freq (non-persistent) and
original_inv_freq (a clone, non-persistent).
INVARIANTS: inv_freq and original_inv_freq are equal at construction;
rope_type must be "default" or a key of ROPE_INIT_FUNCTIONS.
EDGE_CASES: config.rope_parameters["rope_type"] must exist (KeyError
otherwise); device passed through to the init function.

### FN: LlamaRotaryEmbedding.compute_default_rope_parameters
PURPOSE: Compute the original RoPE inverse frequencies and the (unused)
attention scaling factor for the default rope type.
DEPENDS_ON: LlamaConfig, torch.
BEHAVIOR: base = rope_parameters["rope_theta"]; dim = head_dim or
hidden_size//num_attention_heads; inv_freq = 1/(base**(arange(0,dim,2)/dim));
return (inv_freq, attention_factor=1.0).
INVARIANTS: inv_freq has length dim/2; attention_factor is always 1.0 for
the default type; computed in float32.
EDGE_CASES: seq_len arg is accepted but unused (signature shared with other
rope init fns); config may be None-typed but must carry rope_parameters.

### FN: LlamaRotaryEmbedding.forward
PURPOSE: Compute cos/sin tables for the given position_ids, supporting
dynamic rope refresh.
DEPENDS_ON: torch, maybe_autocast, @dynamic_rope_update.
BEHAVIOR: Expand inv_freq to (batch, -1, 1) and position_ids to (1, seq);
force float32; freqs = inv_freq @ position_ids (transposed); emb =
cat(freqs, freqs); cos = emb.cos()*attention_scaling; sin =
emb.sin()*attention_scaling; cast to x.dtype.
INVARIANTS: cos/sin have shape (batch, seq_len, head_dim); computed in
float32 then downcast; no grad (@torch.no_grad()).
EDGE_CASES: mps device is treated as "cpu" for autocast selection;
@dynamic_rope_update may refresh inv_freq for long contexts before the body.

### FN: rotate_half
PURPOSE: Rotate half the hidden dims: split last dim in two, negate and
swap the halves.
DEPENDS_ON: torch.
BEHAVIOR: x1 = x[..., :D/2]; x2 = x[..., D/2:]; return cat((-x2, x1), -1).
INVARIANTS: Last dimension must be even; output shape == input shape.
EDGE_CASES: Odd last dim would silently mis-split (D//2 floor) — not
expected for RoPE head dims.

### FN: apply_rotary_pos_emb
PURPOSE: Apply rotary position embedding to query and key tensors.
DEPENDS_ON: rotate_half, torch, @use_kernel_func_from_hub.
BEHAVIOR: Unsqueeze cos/sin on unsqueeze_dim; q_embed = q*cos +
rotate_half(q)*sin; k_embed likewise; return (q_embed, k_embed).
INVARIANTS: cos/sin broadcast to q/k shapes via unsqueeze_dim; q and k
share the same cos/sin.
EDGE_CASES: unsqueeze_dim defaults to 1 (batch*heads axis); a hub kernel
may replace this fn entirely at runtime.

### FN: LlamaMLP.__init__
PURPOSE: Construct the SwiGLU feed-forward block.
DEPENDS_ON: torch.nn, ACT2FN, LlamaConfig.
BEHAVIOR: Store hidden_size/intermediate_size; gate_proj, up_proj
(hidden->intermediate), down_proj (intermediate->hidden), all bias
controlled by config.mlp_bias; act_fn = ACT2FN[hidden_act].
INVARIANTS: gate/up/down dims consistent; act_fn resolved from config.
EDGE_CASES: config.hidden_act must be a key in ACT2FN (KeyError otherwise).

### FN: LlamaMLP.forward
PURPOSE: SwiGLU activation: down_proj(act_fn(gate_proj(x)) * up_proj(x)).
DEPENDS_ON: self.gate_proj/up_proj/down_proj/act_fn.
BEHAVIOR: gate = act_fn(gate_proj(x)); return down_proj(gate * up_proj(x)).
INVARIANTS: Elementwise gate*up then down projection; shape preserved
(hidden -> intermediate -> hidden).
EDGE_CASES: none beyond upstream linear/activation errors.

### FN: repeat_kv
PURPOSE: Repeat grouped key/value heads to match the number of query heads
(GQA/MQA).
DEPENDS_ON: torch.
BEHAVIOR: If n_rep==1 return as-is; else expand (b, n_kv, slen, hd) to
(b, n_kv, n_rep, slen, hd) and reshape to (b, n_kv*n_rep, slen, hd).
INVARIANTS: n_rep = num_attention_heads // num_key_value_heads; output
num heads == num_attention_heads.
EDGE_CASES: n_rep==1 short-circuits (no copy); assumes n_kv*n_rep equals
num_attention_heads.

### FN: eager_attention_forward
PURPOSE: Reference eager attention implementation (the correctness baseline
and fallback for the attention interface).
DEPENDS_ON: torch.nn, repeat_kv.
BEHAVIOR: repeat_kv key/value to query head count; attn_weights =
matmul(q, k^T)*scaling; add mask if given; softmax in float32 then cast to
q.dtype; dropout (training only); attn_output = matmul(weights, value);
transpose to (batch, seq, *, head_dim) and contiguous.
INVARIANTS: Scaling = head_dim**-0.5 (passed in); softmax over last dim;
float32 softmax for stability.
EDGE_CASES: attention_mask None skips the add; dropout p=0 by default;
returns (attn_output, attn_weights).

### FN: LlamaAttention.__init__
PURPOSE: Construct multi-head (grouped-query) attention projections and
metadata.
DEPENDS_ON: torch.nn, LlamaConfig.
BEHAVIOR: Resolve head_dim (config.head_dim or hidden//num_heads);
num_key_value_groups = num_heads // num_kv_heads; scaling = head_dim**-0.5;
store attention_dropout, is_causal=True; build q_proj (hidden ->
num_heads*head_dim), k_proj/v_proj (hidden -> num_kv*head_dim), o_proj
(num_heads*head_dim -> hidden), all bias=config.attention_bias.
INVARIANTS: num_key_value_groups integer >=1; q/k/v/o dims consistent with
GQA; is_causal always True for LLaMA.
EDGE_CASES: head_dim falls back to hidden//num_attention_heads when unset.

### FN: LlamaAttention.forward
PURPOSE: Run one self-attention pass: project, apply RoPE, update KV cache,
attend, project out.
DEPENDS_ON: apply_rotary_pos_emb, ALL_ATTENTION_FUNCTIONS, past_key_values (Cache).
BEHAVIOR: Reshape hidden to (batch, seq, -1, head_dim) and transpose to
(batch, heads, seq, head_dim) for q/k/v; apply rotary; update KV cache if
present; pick attention_interface via
ALL_ATTENTION_FUNCTIONS.get_interface(config._attn_implementation,
eager_attention_forward); call it with dropout/scaling; reshape output to
(batch, seq, -1) and project via o_proj.
INVARIANTS: Returns (attn_output, attn_weights); q/k rotated with the same
cos/sin; cache updated at self.layer_idx.
EDGE_CASES: dropout=0.0 in eval, config.attention_dropout in training;
position_embeddings tuple must be provided (cos, sin).

### FN: LlamaDecoderLayer.__init__
PURPOSE: Assemble one decoder block: attention, MLP, and two RMSNorms.
DEPENDS_ON: LlamaAttention, LlamaMLP, LlamaRMSNorm, LlamaConfig.
BEHAVIOR: Build self_attn = LlamaAttention(config, layer_idx); mlp =
LlamaMLP(config); input_layernorm and post_attention_layernorm =
LlamaRMSNorm(hidden_size, eps=rms_norm_eps).
INVARIANTS: Inherits GradientCheckpointingLayer; two RMSNorms share the
same eps from config.
EDGE_CASES: layer_idx forwarded to attention for cache slotting.

### FN: LlamaDecoderLayer.forward
PURPOSE: Pre-norm residual decoder block: attention then MLP, each with a
residual connection.
DEPENDS_ON: self.self_attn, self.mlp, input/post_attention_layernorm.
BEHAVIOR: residual = x; h = input_layernorm(x); h,_ = self_attn(h,
attention_mask, position_ids, past_key_values, use_cache,
position_embeddings, **kwargs); x = residual + h; residual = x; h =
post_attention_layernorm(x); h = mlp(h); return residual + h.
INVARIANTS: Pre-norm (norm before sublayer); residuals are additive;
returns hidden_states only.
EDGE_CASES: kwargs forwarded to attention; use_cache/past_key_values
threaded through; position_embeddings passed in (computed once by the
stack, not per layer).

### FN: LlamaModel.__init__
PURPOSE: Construct the base LLaMA decoder: embeddings, layer stack, final
norm, rotary embeddings.
DEPENDS_ON: LlamaPreTrainedModel, nn.Embedding/ModuleList, LlamaDecoderLayer, LlamaRMSNorm, LlamaRotaryEmbedding.
BEHAVIOR: super().__init__(config); store padding_idx/vocab_size;
embed_tokens = Embedding(vocab, hidden, padding_idx); layers = ModuleList
of num_hidden_layers decoder layers; norm = LlamaRMSNorm; rotary_emb =
LlamaRotaryEmbedding(config); gradient_checkpointing=False; post_init().
INVARIANTS: Number of layers == config.num_hidden_layers; embed padding_idx
honored.
EDGE_CASES: post_init() runs weight init + gradient checkpointing defaults.

### FN: LlamaModel.forward
PURPOSE: Run the full decoder stack and return last hidden state + cache.
DEPENDS_ON: create_causal_mask, DynamicCache, LlamaRotaryEmbedding, embed_tokens, LlamaDecoderLayer, LlamaRMSNorm.
BEHAVIOR: XOR-check input_ids/inputs_embeds; embed if needed; init
DynamicCache when use_cache and none given; derive position_ids from cache
length if absent; build causal_mask via create_causal_mask; compute
position_embeddings once; run layers[:num_hidden_layers] passing mask,
position_embeddings, position_ids, cache, use_cache, kwargs; apply final
norm; return BaseModelOutputWithPast(last_hidden_state, past_key_values).
INVARIANTS: Exactly one of input_ids/inputs_embeds (else ValueError);
layers sliced to config.num_hidden_layers; decorated
@merge_with_config_defaults @capture_outputs @auto_docstring.
EDGE_CASES: position_ids auto-derived from past_seen_tokens; cache may be
None even with use_cache (created on demand); outputs captured by
@capture_outputs.

### FN: LlamaForCausalLM.__init__
PURPOSE: Construct the causal LM: base model + LM head.
DEPENDS_ON: LlamaPreTrainedModel, GenerationMixin, LlamaModel, nn.Linear.
BEHAVIOR: super().__init__(config); self.model = LlamaModel(config);
vocab_size from config; lm_head = Linear(hidden, vocab, bias=False);
post_init(). Declares _tied_weights_keys tying lm_head.weight to
model.embed_tokens.weight; _tp_plan/_pp_plan for lm_head.
INVARIANTS: lm_head has no bias; lm_head.weight tied to embed_tokens.weight.
EDGE_CASES: post_init() handles tie_weights via the declared key map.

### FN: LlamaForCausalLM.forward
PURPOSE: Compute logits (and optional loss) for causal language modeling.
DEPENDS_ON: LlamaModel.forward, self.lm_head, self.loss_function.
BEHAVIOR: Run self.model(...) → BaseModelOutputWithPast; take
last_hidden_state; slice via logits_to_keep (int → slice(-logits_to_keep,
None), else tensor index); logits = lm_head(sliced hidden); if labels given,
loss = self.loss_function(logits, labels, vocab_size, **kwargs); return
CausalLMOutputWithPast(loss, logits, past_key_values, hidden_states,
attentions).
INVARIANTS: Decorated @can_return_tuple @auto_docstring; logits not
upcast to float unless loss is computed; lm_head tied weights.
EDGE_CASES: logits_to_keep=0 → keep all (slice(-0,None) is all); labels
None → loss None; kwargs forwarded to both model and loss_function.
--- PSEUDOCODE 2026-07-23T19:41:58Z ---
