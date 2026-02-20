import { useState } from 'react';
import type { WaveConfig } from '../config/waveConfig';
import { configLimits, wavePresets } from '../config/waveConfig';

interface ControlPanelProps {
  config: WaveConfig;
  onChange: (config: WaveConfig) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, unit = '', onChange }: SliderProps) {
  return (
    <div className="slider-group">
      <div className="slider-header">
        <label>{label}</label>
        <span className="slider-value">
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <div className="toggle-group">
      <label>{label}</label>
      <button
        className={`toggle-switch ${checked ? 'active' : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <div className="color-picker-group">
      <label>{label}</label>
      <div className="color-picker-input">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="color-value">{value}</span>
      </div>
    </div>
  );
}

type SectionKey = 'waves' | 'wind' | 'canyon' | 'visual';

export function ControlPanel({ config, onChange, isOpen: controlledIsOpen, onOpenChange }: ControlPanelProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(() => window.innerWidth >= 640);

  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalIsOpen(open);
    }
  };

  const [expandedSections, setExpandedSections] = useState<Record<SectionKey, boolean>>({
    waves: true,
    wind: false,
    canyon: false,
    visual: true,
  });

  const updateConfig = <K extends keyof WaveConfig>(key: K, value: WaveConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const toggleSection = (section: SectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const applyPreset = (presetName: keyof typeof wavePresets) => {
    onChange({
      ...wavePresets[presetName],
      wireframe: config.wireframe,
      animateWaves: config.animateWaves,
      waveColor: config.waveColor,
      theme: config.theme,
    });
  };

  if (!isOpen) {
    return (
      <button
        className="panel-toggle collapsed"
        onClick={() => setIsOpen(true)}
        aria-label="Open controls"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    );
  }

  return (
    <div className="control-panel">
      <div className="panel-header">
        <h2>Wave Parameters</h2>
        <button
          className="panel-toggle"
          onClick={() => setIsOpen(false)}
          aria-label="Close controls"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div className="presets">
        <span className="preset-label">Presets:</span>
        <div className="preset-buttons">
          <button onClick={() => applyPreset('calm')}>Calm</button>
          <button onClick={() => applyPreset('moderate')}>Moderate</button>
          <button onClick={() => applyPreset('big')}>Big</button>
          <button onClick={() => applyPreset('extreme')}>Extreme</button>
        </div>
      </div>

      <div className="sections">
        {/* Wave Parameters Section */}
        <div className="section">
          <button className="section-header" onClick={() => toggleSection('waves')}>
            <span>Primary Waves</span>
            <svg
              className={`chevron ${expandedSections.waves ? 'expanded' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          {expandedSections.waves && (
            <div className="section-content">
              <Slider
                label="Wave Height"
                value={config.waveHeight}
                {...configLimits.waveHeight}
                unit="m"
                onChange={(v) => updateConfig('waveHeight', v)}
              />
              <Slider
                label="Wave Period"
                value={config.wavePeriod}
                {...configLimits.wavePeriod}
                unit="s"
                onChange={(v) => updateConfig('wavePeriod', v)}
              />
              <Slider
                label="Wave Direction"
                value={config.waveDirection}
                {...configLimits.waveDirection}
                unit="°"
                onChange={(v) => updateConfig('waveDirection', v)}
              />
              <Slider
                label="Wave Length"
                value={config.waveLength}
                {...configLimits.waveLength}
                unit="m"
                onChange={(v) => updateConfig('waveLength', v)}
              />
              <Slider
                label="Animation Speed"
                value={config.timeScale}
                {...configLimits.timeScale}
                onChange={(v) => updateConfig('timeScale', v)}
              />

              <div className="subsection">
                <span className="subsection-title">Secondary Swell</span>
                <Slider
                  label="Height"
                  value={config.secondaryWaveHeight}
                  {...configLimits.secondaryWaveHeight}
                  unit="m"
                  onChange={(v) => updateConfig('secondaryWaveHeight', v)}
                />
                <Slider
                  label="Period"
                  value={config.secondaryWavePeriod}
                  {...configLimits.secondaryWavePeriod}
                  unit="s"
                  onChange={(v) => updateConfig('secondaryWavePeriod', v)}
                />
                <Slider
                  label="Direction"
                  value={config.secondaryWaveDirection}
                  {...configLimits.secondaryWaveDirection}
                  unit="°"
                  onChange={(v) => updateConfig('secondaryWaveDirection', v)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Wind Parameters Section */}
        <div className="section">
          <button className="section-header" onClick={() => toggleSection('wind')}>
            <span>Wind</span>
            <svg
              className={`chevron ${expandedSections.wind ? 'expanded' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          {expandedSections.wind && (
            <div className="section-content">
              <Slider
                label="Wind Speed"
                value={config.windSpeed}
                {...configLimits.windSpeed}
                unit=" m/s"
                onChange={(v) => updateConfig('windSpeed', v)}
              />
              <Slider
                label="Wind Direction"
                value={config.windDirection}
                {...configLimits.windDirection}
                unit="°"
                onChange={(v) => updateConfig('windDirection', v)}
              />
              <Slider
                label="Chop Intensity"
                value={config.windChopIntensity}
                {...configLimits.windChopIntensity}
                onChange={(v) => updateConfig('windChopIntensity', v)}
              />
            </div>
          )}
        </div>

        {/* Canyon Effect Section */}
        <div className="section">
          <button className="section-header" onClick={() => toggleSection('canyon')}>
            <span>Canyon Effect</span>
            <svg
              className={`chevron ${expandedSections.canyon ? 'expanded' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          {expandedSections.canyon && (
            <div className="section-content">
              <Slider
                label="Amplification"
                value={config.canyonAmplification}
                {...configLimits.canyonAmplification}
                unit="x"
                onChange={(v) => updateConfig('canyonAmplification', v)}
              />
              <Slider
                label="Focus Width"
                value={config.canyonFocusWidth}
                {...configLimits.canyonFocusWidth}
                onChange={(v) => updateConfig('canyonFocusWidth', v)}
              />
              <Slider
                label="Depth Effect"
                value={config.canyonDepthEffect}
                {...configLimits.canyonDepthEffect}
                onChange={(v) => updateConfig('canyonDepthEffect', v)}
              />
            </div>
          )}
        </div>

        {/* Visual Parameters Section */}
        <div className="section">
          <button className="section-header" onClick={() => toggleSection('visual')}>
            <span>Display</span>
            <svg
              className={`chevron ${expandedSections.visual ? 'expanded' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          {expandedSections.visual && (
            <div className="section-content">
              <Toggle
                label="Dark Theme"
                checked={config.theme === 'dark'}
                onChange={(v) => updateConfig('theme', v ? 'dark' : 'light')}
              />
              <Toggle
                label="Animate Waves"
                checked={config.animateWaves}
                onChange={(v) => updateConfig('animateWaves', v)}
              />
              <Toggle
                label="Wireframe Grid"
                checked={config.wireframe}
                onChange={(v) => updateConfig('wireframe', v)}
              />
              <ColorPicker
                label="Wave Color"
                value={config.waveColor}
                onChange={(v) => updateConfig('waveColor', v)}
              />
              <Slider
                label="Foam Threshold"
                value={config.foamThreshold}
                {...configLimits.foamThreshold}
                onChange={(v) => updateConfig('foamThreshold', v)}
              />
              <Slider
                label="Foam Intensity"
                value={config.foamIntensity}
                {...configLimits.foamIntensity}
                onChange={(v) => updateConfig('foamIntensity', v)}
              />
              <Slider
                label="Water Clarity"
                value={config.waterClarity}
                {...configLimits.waterClarity}
                onChange={(v) => updateConfig('waterClarity', v)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="panel-footer">
        <span className="info-text">
          Nazaré Canyon amplifies waves up to {config.canyonAmplification.toFixed(1)}x
        </span>
      </div>
    </div>
  );
}
