import {
  observable, action, toJS, isObservable,
} from 'mobx';
import { assign, pick } from 'lodash-es';
import { createUuid } from '../../util/uuid';
import { defaultTheme } from '../../constant/DefaultTheme';
import {
  ElementState, ModelType, ElementType,
} from '../../constant/constant';
import {
  AdditionData, NodeData, NodeAttribute, NodeConfig, NodeMoveRule, Bounds, Point,
} from '../../type';
import GraphModel from '../GraphModel';
import { IBaseModel } from '../BaseModel';
import { formatData } from '../../util/compatible';
import { pickNodeConfig } from '../../util/node';

const defaultConfig = assign(
  {
    x: 0,
    y: 0,
    zIndex: 1,
    text: {
      value: '',
      x: 0,
      y: 0,
      draggable: false,
      editable: true,
    },
  },
  defaultTheme.rect,
  defaultTheme.circle,
);

export type ConnectRule = {
  message: string;
  validate: (source: BaseNodeModel, target: BaseNodeModel) => boolean;
};

export type ConnectRuleResult = {
  isAllPass: boolean;
  msg?: string;
};

export { BaseNodeModel };
export default class BaseNodeModel implements IBaseModel {
  readonly id = createUuid();
  readonly BaseType = ElementType.NODE;
  modelType = ModelType.NODE;
  additionStateData: AdditionData;
  [propName: string]: any; // 支持自定义
  targetRules: ConnectRule[] = [];
  sourceRules: ConnectRule[] = [];
  moveRules: NodeMoveRule[] = []; // 节点移动之前的hook
  hasSetTargetRules = false; // 用来限制rules的重复值
  hasSetSourceRules = false; // 用来限制rules的重复值
  @observable properties: Record<string, any> = {};
  @observable type = '';
  @observable x = defaultConfig.x;
  @observable y = defaultConfig.y;
  @observable
  private _width = defaultConfig.width;
  graphModel: GraphModel;
  public get width() {
    return this._width;
  }
  public set width(value) {
    this._width = value;
  }
  @observable
  private _height = defaultConfig.height;
  public get height() {
    return this._height;
  }
  public set height(value) {
    this._height = value;
  }
  @observable fill = defaultConfig.fill;
  @observable fillOpacity = defaultConfig.fillOpacity;
  @observable strokeWidth = defaultConfig.strokeWidth;
  @observable stroke = defaultConfig.stroke;
  @observable strokeOpacity = defaultConfig.strokeOpacity;
  @observable opacity = defaultConfig.opacity;
  @observable outlineColor = defaultConfig.outlineColor;
  @observable hoverOutlineColor = defaultConfig.hoverOutlineColor;
  @observable outlineStrokeDashArray = defaultConfig.outlineStrokeDashArray;
  @observable hoverOutlineStrokeDashArray = defaultConfig.hoverOutlineStrokeDashArray;
  @observable isSelected = false;
  @observable isHovered = false;
  @observable isHitable = true; // 细粒度控制节点是否对用户操作进行反应
  @observable zIndex = defaultConfig.zIndex;
  @observable anchorsOffset = []; // 根据与(x, y)的偏移量计算anchors的坐标
  @observable state = 1;
  @observable text = defaultConfig.text;
  @observable draggable = true;

  constructor(data: NodeConfig, graphModel: GraphModel, type) {
    this.graphModel = graphModel;
    this.setStyleFromTheme(type, graphModel);
    this.initNodeData(data);
    this.setAttributes();
  }

  initNodeData(data) {
    if (!data.properties) {
      data.properties = {};
    }

    if (!data.id) {
      const { idGenerator } = this.graphModel;
      const globalId = idGenerator && idGenerator();
      if (globalId) data.id = globalId;
      const nodeId = this.createId();
      if (nodeId) data.id = nodeId;
    }

    this.formatText(data);
    assign(this, pickNodeConfig(data));
  }

  createId() {
    return null;
  }

  // 格式化text参数，未修改observable不作为action
  formatText(data): void {
    if (!data.text) {
      data.text = {
        value: '',
        x: data.x,
        y: data.y,
        draggable: false,
        editable: true,
      };
    }
    if (data.text && typeof data.text === 'string') {
      data.text = {
        value: data.text,
        x: data.x,
        y: data.y,
        draggable: false,
        editable: true,
      };
    } else if (data.text && data.text.editable === undefined) {
      data.text.editable = true;
    }
  }

  setAttributes() {}

  /**
   * 保存时获取的数据
   */
  getData(): NodeData {
    const { x, y, value } = this.text;
    let { properties } = this;
    if (isObservable(properties)) {
      properties = toJS(properties);
    }
    const data: NodeData = {
      id: this.id,
      type: this.type,
      x: this.x,
      y: this.y,
      properties,
    };
    if (value) {
      data.text = {
        x,
        y,
        value,
      };
    }
    return data;
  }

  getProperties() {
    return toJS(this.properties);
  }

  /**
   * 在连线的时候，是否允许这个节点为source节点，连线到target节点。
   */
  isAllowConnectedAsSource(target: BaseNodeModel): ConnectRuleResult | Boolean{
    const rules = !this.hasSetSourceRules
      ? this.getConnectedSourceRules()
      : this.sourceRules;
    this.hasSetSourceRules = true;
    let isAllPass = true;
    let msg: string;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule.validate.call(this, this, target)) {
        isAllPass = false;
        msg = rule.message;
        break;
      }
    }
    return {
      isAllPass,
      msg,
    };
  }

  /**
   * 获取当前节点作为连接的起始节点规则。
   */
  getConnectedSourceRules(): ConnectRule[] {
    return this.sourceRules;
  }
  /**
   * 在连线的时候，是否允许这个节点未target节点
   */

  isAllowConnectedAsTarget(source: BaseNodeModel): ConnectRuleResult | Boolean {
    const rules = !this.hasSetTargetRules
      ? this.getConnectedTargetRules()
      : this.targetRules;
    this.hasSetTargetRules = true;
    let isAllPass = true;
    let msg: string;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule.validate.call(this, source, this)) {
        isAllPass = false;
        msg = rule.message;
        break;
      }
    }
    return {
      isAllPass,
      msg,
    };
  }
  /**
   * 是否允许移动节点到新的位置
   */
  isAllowMoveNode(deltaX, deltaY) {
    for (const rule of this.moveRules) {
      if (!rule(this, deltaX, deltaY)) return false;
    }
    for (const rule of this.graphModel.nodeMoveRules) {
      if (!rule(this, deltaX, deltaY)) return false;
    }
    return true;
  }

  getConnectedTargetRules(): ConnectRule[] {
    return this.targetRules;
  }

  getAnchorsByOffset(): Point[] {
    const {
      anchorsOffset, x, y, id,
    } = this;
    return anchorsOffset.map((el, idx) => {
      if (el.length) {
        return {
          id: `${id}_${idx}`,
          x: x + el[0],
          y: y + el[1],
        };
      }
      return {
        x: x + el.x,
        y: y + el.y,
        id: el.id || `${id}_${idx}`,
      };
    });
  }
  /**
   * 获取节点区域
   */
  getBounds(): Bounds {
    return {
      x1: this.x - this.width / 2,
      y1: this.y - this.height / 2,
      x2: this.x + this.width / 2,
      y2: this.y + this.height / 2,
    };
  }

  get anchors() {
    const {
      anchorsOffset,
    } = this;
    if (anchorsOffset && anchorsOffset.length > 0) {
      return this.getAnchorsByOffset();
    }
    return [];
  }

  @action
  addNodeMoveRules(fn: NodeMoveRule) {
    if (!this.moveRules.includes(fn)) {
      this.moveRules.push(fn);
    }
  }
  @action
  move(deltaX, deltaY, isignoreRule = false): void {
    if (!isignoreRule && !this.isAllowMoveNode(deltaX, deltaY)) return;
    const targetX = this.x + deltaX;
    const targetY = this.y + deltaY;
    this.x = targetX;
    this.y = targetY;
    this.text && this.moveText(deltaX, deltaY);
  }

  @action
  moveTo(x, y, isignoreRule = false): void {
    const deltaX = x - this.x;
    const deltaY = y - this.y;
    if (!isignoreRule && !this.isAllowMoveNode(deltaX, deltaY)) return;
    if (this.text) {
      this.text && this.moveText(deltaX, deltaY);
    }
    this.x = x;
    this.y = y;
  }

  @action
  moveText(deltaX, deltaY): void {
    const {
      x,
      y,
      value,
      draggable,
      editable,
    } = this.text;
    this.text = {
      value,
      editable,
      draggable,
      x: x + deltaX,
      y: y + deltaY,
    };
  }

  @action
  updateText(value: string): void {
    this.text.value = value;
  }

  @action
  setSelected(flag = true): void {
    this.isSelected = flag;
  }

  @action
  setHovered(flag = true): void {
    this.isHovered = flag;
  }

  @action
  setHitable(flag = true): void {
    this.isHitable = flag;
  }

  @action
  setElementState(state: ElementState, additionStateData?: AdditionData): void {
    this.state = state;
    this.additionStateData = additionStateData;
  }

  @action
  updateStroke(color): void {
    this.stroke = color;
  }

  /* 更新数据 */
  @action
  updateData(nodeAttribute: NodeAttribute): void {
    // formatData兼容vue数据
    const nodeData = formatData(pick(nodeAttribute, 'type', 'x', 'y', 'text', 'properties'));
    // 兼容text, object/string类型
    const {
      x,
      y,
      draggable,
      editable,
    } = this.text;
    if (nodeData.text && typeof nodeData.text === 'string') {
      nodeData.text = {
        x,
        y,
        value: nodeData.text,
        draggable,
        editable,
      };
    } else if (typeof nodeData.text === 'object') {
      const text = { ...this.text, ...nodeData.text };
      nodeData.text = pick(text, 'x', 'y', 'value', 'draggable', 'editable');
    }
    assign(this, nodeData);
  }

  @action
  setProperty(key, val): void {
    this.properties = {
      ...this.properties,
      [key]: formatData(val),
    };
  }

  @action
  setProperties(properties): void {
    // fix: vue setProperties not observable
    this.properties = {
      ...this.properties,
      ...formatData(properties),
    };
  }

  @action
  setStyleFromTheme(type, graphModel): void {
    const { theme } = graphModel;
    if (theme[type]) {
      assign(this, theme[type]);
    }
  }

  @action
  setZIndex(zindex: number = defaultConfig.zIndex): void {
    this.zIndex = zindex;
  }

  @action
  updateAttributes(attributes) {
    assign(this, attributes);
  }
}
