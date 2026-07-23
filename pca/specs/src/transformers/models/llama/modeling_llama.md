# per-file spec — src/transformers/models/llama/modeling_llama.py

Capability: `llama-modeling`. This spec mirrors `T_annotate`
(PURPOSE / DEPENDS_ON / BEHAVIOR / INVARIANTS / EDGE_CASES) and distills the
annotated understanding of every function in the file into whole-file
requirements and scenarios. There are no per-symbol sections.

## PURPOSE

Implement the LLaMA neural architecture as a Transformers `PreTrainedModel`
family: RMS normalization, rotary position embeddings, grouped-query
attention, a SwiGLU MLP, a pre-norm residual decoder stack, the base
decoder, a causal language-model head, and three thin task heads
(sequence classification, question answering, token classification) bound
to shared generic mixins.

## DEPENDS_ON

- `llama-configuration` (`LlamaConfig`) — every architectural constant,
  RoPE parameters, distributed plans, and attention-backend flags.
- `...activations.ACT2FN` — activation lookup by `config.hidden_act`.
- `...cache_utils.{Cache, DynamicCache}` — KV cache abstraction.
- `...generation.GenerationMixin` — generation support for `LlamaForCausalLM`.
- `...integrations.{use_kernel_forward_from_hub, use_kernel_func_from_hub, use_kernelized_func}` — opt-in kernel replacement for RMSNorm / rotary.
- `...masking_utils.create_causal_mask` — causal mask construction.
- `...modeling_layers.{GenericForQuestionAnswering, GenericForSequenceClassification, GenericForTokenClassification, GradientCheckpointingLayer}` — generic task heads and gradient-checkpointing base layer.
- `...modeling_outputs.{BaseModelOutputWithPast, CausalLMOutputWithPast}` — output dataclasses.
- `...modeling_rope_utils.{ROPE_INIT_FUNCTIONS, dynamic_rope_update}` — RoPE init dispatch and dynamic refresh.
- `...modeling_utils.{ALL_ATTENTION_FUNCTIONS, PreTrainedModel}` — pluggable attention interface and the base model class.
- `...utils.{TransformersKwargs, auto_docstring, can_return_tuple, logging}` and `...utils.generic.{maybe_autocast, merge_with_config_defaults}`, `...utils.output_capturing.capture_outputs` — decorators and helpers.

## BEHAVIOR

### RMSNorm (`LlamaRMSNorm`)

- Requirement: normalize hidden states by their root mean square and
  re-scale by a learnable per-feature weight.
- Scenario: given hidden states of dtype D, upcast to float32, compute
  `weight * x * rsqrt(mean(x^2, -1) + eps)`, and return in dtype D.
- Scenario: `extra_repr` returns `"{weight.shape}, eps={eps}"` for repr.

### Rotary embeddings (`LlamaRotaryEmbedding`, `rotate_half`, `apply_rotary_pos_emb`)

- Requirement: produce `cos`/`sin` tables for `position_ids` from the
  configured RoPE type and apply the rotation to query/key tensors.
- Scenario: construction resolves `inv_freq` via the default formula or
  `ROPE_INIT_FUNCTIONS[rope_type]` and registers it (non-persistent).
- Scenario: `forward` computes `cos`/`sin` in float32 (autocast disabled,
  mps treated as cpu), applies `attention_scaling`, and downcasts to
  `x.dtype`; `@dynamic_rope_update` may refresh `inv_freq` first.
- Scenario: `apply_rotary_pos_emb` unsqueezes `cos`/`sin` on
  `unsqueeze_dim`, rotates q and k via `rotate_half`, returns
  `(q_embed, k_embed)`. A hub kernel may replace it at runtime.

### MLP (`LlamaMLP`)

- Requirement: SwiGLU feed-forward — `down_proj(act_fn(gate_proj(x)) *
  up_proj(x))`, bias controlled by `config.mlp_bias`.

### Attention (`LlamaAttention`, `repeat_kv`, `eager_attention_forward`)

- Requirement: grouped-query self-attention with pluggable backend.
- Scenario: project q/k/v (GQA layout via `num_key_value_groups`), reshape
  to `(batch, heads, seq, head_dim)`, apply RoPE, update the KV cache at
  `layer_idx`, dispatch via
  `ALL_ATTENTION_FUNCTIONS.get_interface(config._attn_implementation,
  eager_attention_forward)`, and project out via `o_proj`.
- Scenario: `eager_attention_forward` is the reference: repeat KV, scaled
  qk matmul, add mask, float32 softmax, dropout (training only), value
  matmul, transpose to `(batch, seq, *, head_dim)`.
- Scenario: `repeat_kv` is a no-op when `n_rep == 1`; otherwise expands
  `(b, n_kv, slen, hd)` to `(b, n_kv*n_rep, slen, hd)`.

### Decoder layer (`LlamaDecoderLayer`)

- Requirement: pre-norm residual block — `x + self_attn(input_layernorm(x))`
  then `x + mlp(post_attention_layernorm(x))`. Returns hidden states only.

### Base model (`LlamaModel`)

- Requirement: embed, build causal mask, compute position embeddings once,
  run the decoder stack sliced to `config.num_hidden_layers`, apply final
  RMSNorm, return `BaseModelOutputWithPast(last_hidden_state,
  past_key_values)`.
- Scenario: exactly one of `input_ids`/`inputs_embeds` (XOR, else
  `ValueError`); `position_ids` auto-derived from cache length when absent;
  `DynamicCache` created when `use_cache` and none supplied.
- Scenario: decorated `@merge_with_config_defaults @capture_outputs
  @auto_docstring`.

### Causal LM (`LlamaForCausalLM`)

- Requirement: run `LlamaModel`, slice logits per `logits_to_keep`, compute
  loss via `self.loss_function` when `labels` are given, return
  `CausalLMOutputWithPast`.
- Scenario: `logits_to_keep` int → `slice(-logits_to_keep, None)`; tensor →
  used as index. `labels is None` → `loss is None`.
- Scenario: `lm_head.weight` tied to `model.embed_tokens.weight`;
  decorated `@can_return_tuple @auto_docstring`.

### Task heads

- `LlamaForSequenceClassification`, `LlamaForQuestionAnswering`
  (`base_model_prefix = "transformer"` for BC), `LlamaForTokenClassification`
  are one-line compositions over `modeling_layers.GenericFor*` with
  `LlamaPreTrainedModel`; no LLaMA-specific methods.

## INVARIANTS

- Exactly one of `input_ids` / `inputs_embeds` is passed to
  `LlamaModel.forward` (XOR enforced).
- RMSNorm and rotary computations upcast to float32 and restore the input
  dtype on output.
- Attention scaling is `head_dim ** -0.5`.
- `num_key_value_groups = num_attention_heads // num_key_value_heads` is an
  integer (GQA/MQA compatibility), derived from config.
- The decoder stack runs `layers[:config.num_hidden_layers]`.
- `LlamaForCausalLM.lm_head.weight` is tied to
  `model.embed_tokens.weight`; `lm_head` has no bias.
- KV cache, when `use_cache` and none supplied, is a
  `DynamicCache(config=self.config)`; `LlamaAttention` updates it at
  `self.layer_idx`.
- Rotary `cos`/`sin` are computed once by the base model and threaded into
  each decoder layer (not recomputed per layer).
- `is_causal = True` for Llama attention.
- Logits are not upcast to float unless a loss is being computed.

## EDGE_CASES

- `input_ids` and `inputs_embeds` both (or neither) supplied →
  `LlamaModel.forward` raises `ValueError`.
- `config.hidden_act` not in `ACT2FN` → `LlamaMLP.__init__` raises
  `KeyError`.
- `config.rope_parameters["rope_type"]` missing or not in
  `ROPE_INIT_FUNCTIONS` (and not `"default"`) →
  `LlamaRotaryEmbedding.__init__` raises `KeyError`.
- `head_dim` unset → defaults to `hidden_size // num_attention_heads`.
- `num_key_value_heads` unset → defaults to `num_attention_heads`.
- `n_rep == 1` in `repeat_kv` → returns inputs unchanged (no copy).
- `attention_mask is None` in `eager_attention_forward` → mask add skipped.
- `logits_to_keep == 0` → all logits kept; `labels is None` → no loss.
- mps device in `LlamaRotaryEmbedding.forward` → autocast device treated as
  `"cpu"`.
- The `@use_kernel_*` / `@use_kernelized_func` decorators may replace
  `LlamaRMSNorm.forward` and `apply_rotary_pos_emb` with hub kernels at
  runtime; the in-file bodies are the reference implementation.
