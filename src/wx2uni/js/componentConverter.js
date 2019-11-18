const t = require('@babel/types');
const nodePath = require('path');
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const Vistor = require("./Vistor");
const clone = require('clone');
const util = require('../../utils/utils');
const pathUtil = require('../../utils/pathUtil');
const babelUtil = require('../../utils/babelUtil');
//


let vistors = {};

//外部定义的变量
let declareStr = '';
//当前处理的js文件路径
let file_js = "";
//当前文件所在目录
let fileDir = "";


/*
 *
 * 注：为防止深层遍历，将直接路过子级遍历，所以使用enter进行全遍历时，孙级节点将跳过
 * 
 */
const componentVistor = {
	IfStatement(path) {
		babelUtil.getAppFunHandle(path);
	},
	ExpressionStatement(path) {
		if (t.isCallExpression(path.node.expression)) {
			const calleeName = t.isIdentifier(path.node.expression.callee) ? path.node.expression.callee.name.toLowerCase() : "";
			const parent = path.parentPath.parent;
			if (t.isFile(parent) && calleeName != "app" && calleeName != "page" && calleeName != "component" && calleeName != "vantcomponent") {
				//定义的外部函数
				declareStr += `${generate(path.node).code}\r\n`;
				path.skip();
			}
		} else if (t.isAssignmentExpression(path.node.expression)) {
			//有可能app.js里是这种结构，exports.default = App({});
			//path.node 为AssignmentExpression类型，所以这里区分一下
			declareStr += `${generate(path.node).code}\r\n`;
		}
	},
	ImportDeclaration(path) {
		//定义的导入的模块
		//处理import模板的路径，转换当前路径以及根路径为相对路径
		let filePath = path.node.source.value;
		filePath = nodePath.join(nodePath.dirname(filePath), pathUtil.getFileNameNoExt(filePath)); //去掉扩展名
		filePath = pathUtil.relativePath(filePath, global.miniprogramRoot, fileDir);
		path.node.source.value = filePath;

		var str = `${generate(path.node).code}\r\n`;
		//
		declareStr += str;
		path.skip();
	},
	VariableDeclaration(path) {
		//将require()里的地址都处理一遍
		traverse(path.node, {
			noScope: true,
			CallExpression(path2) {
				let callee = path2.get("callee");
				let property = path2.get("property");
				if (t.isIdentifier(callee.node, { name: "require" })) {
					let arguments = path2.node.arguments;
					if (arguments && arguments.length) {
						if (t.isStringLiteral(arguments[0])) {
							let filePath = arguments[0].value;
							filePath = pathUtil.relativePath(filePath, global.miniprogramRoot, fileDir);
							path2.node.arguments[0] = t.stringLiteral(filePath);
						}
					}
				} else if (t.isIdentifier(callee.node, { name: "getApp" })) {
					/**
					 * getApp().xxx; 
					 * 替换为:
					 * getApp().globalData.xxx;
					 * 
					 * 虽然var app = getApp()已替换，还是会有漏网之鱼，如var t = getApp();
					 */
					const me = t.memberExpression(t.callExpression(t.identifier("getApp"), []), t.identifier("globalData"));
					path2.replaceWith(me);
					path2.skip();
				}
			},
			VariableDeclarator(path2) {
				if (t.isMemberExpression(path2.node.init) && path2.node.init.object) {
					let id = path2.node.id;
					let init = path2.node.init;
					let property = init.property;
					let objectPath = path2.node.init.object;
					let subOject = objectPath.object;
					let subProperty = objectPath.property;
					if (t.isIdentifier(subOject, { name: "app" })) {
						//这里没法调babelUtil.globalDataHandle()，子节点没有replaceWidth方法了(或许有转换方法，暂未知)
						let getApp = t.callExpression(t.identifier('getApp'), []);
						let subMe = t.MemberExpression(t.MemberExpression(getApp, t.identifier('globalData')), subProperty);
						let me = t.MemberExpression(subMe, property);
						let vd = t.variableDeclarator(path2.node.id, me);
						path.replaceWith(vd);
						path.skip();
					}
				} else if (t.isCallExpression(path2.node.init)) {
					//处理外部声明的require，如var md5 = require("md5.js");
					const initPath = path2.node.init;
					let callee = initPath.callee;
					if (t.isIdentifier(callee, { name: "require" })) {
						let arguments = initPath.arguments;
						if (arguments && arguments.length) {
							if (t.isStringLiteral(arguments[0])) {
								let filePath = arguments[0].value;
								filePath = pathUtil.relativePath(filePath, global.miniprogramRoot, fileDir);
								initPath.arguments[0] = t.stringLiteral(filePath);
							}
						}
					}
					//删除var wxParse = require("../../../wxParse/wxParse.js");
					if (path2.node && path2.node.id && path2.node.id.name && path2.node.id.name.toLowerCase() === "wxparse") {
						// babelUtil.addComment(path.parentPath, `${generate(path.node).code}`);  //没法改成注释，只能删除
						path.remove();
					}
				}
			},
			MemberExpression(path) {
				babelUtil.globalDataHandle(path);
			}
		});
		const parent = path.parentPath.parent;
		if (t.isFile(parent)) {
			//定义的外部变量
			// vistors.variable.handle(path.node);
			declareStr += `${generate(path.node).code}\r\n`;
			path.skip();
		}
	},
	FunctionDeclaration(path) {
		const parent = path.parentPath.parent;
		if (t.isFile(parent)) {

			babelUtil.getAppFunHandle(path);

			//定义的外部函数
			declareStr += `${generate(path.node).code}\r\n`;
			path.skip();
		}
	},
	ObjectProperty(path) {
		const name = path.node.key.name;
		// console.log("name", path.node.key.name)
		// console.log("name", path.node.key.name)
		switch (name) {
			case 'data':
				var properties = path.node.value.properties;
				if (properties) {
					properties.forEach(function (item) {

						console.log("item --- ", item);
						item.key.name = util.getValueAlias(item.key.name);
						// let _name = util.getValueAlias(name);
						vistors[name].handle(item);
					});
				}
				path.skip();
				break;
			case 'computed':
			case 'watch':
			case 'observers':
				var properties = path.node.value.properties;
				if (properties) {
					properties.forEach(function (item) {
						// if(item.key.name === "data") item.key.name="pData";
						vistors[name === "observers" ? "watch" : name].handle(item);
					});
				}
				///////////////////////////////////
				//TODO: observers需要处理成深度监听，但还得判断data/prop里是使用类型的
				//判断data是否有prop一致的，还需要分割,进行
				path.skip();
				break;
			case 'properties':
				//组件特有生命周期: properties-->props
				var properties = path.get("value.properties");
				if (properties) {
					properties.forEach(function (item) {
						///////////////////////////////
						// proE: {
						// 	type: Array,
						// 	value: []
						// }
						//-->
						// proE: {
						// 	type: Array,
						// 	default: () => []
						// }
						///////////////////////////////
						// proE: {
						// 	type: Object,
						// 	value: {}
						// }
						//-->
						// proE: {
						// 	type: Object,
						// 	default: () => ({})
						// }
						let propItemName = item.node.key.name;
						propItemName = util.getValueAlias(propItemName);
						//
						const props = item.get("value.properties");
						let typeItem = null;
						let defaultItem = null;
						let observerItem = null;
						props.forEach(function (subItem) {
							const name = subItem.node.key.name;
							switch (name) {
								case "value":
									subItem.node.key.name = "default";
									defaultItem = subItem;
									break;
								case "type":
									typeItem = subItem;
									break;
								case "observer":
									observerItem = subItem;
									break;
							}
						});
						if (typeItem && defaultItem) {
							if (typeItem.node.value.name == "Array" || typeItem.node.value.name == "Object") {
								let afx = t.arrowFunctionExpression([], defaultItem.node.value);
								let op = t.ObjectProperty(defaultItem.node.key, afx);
								defaultItem.replaceWith(op);
							}
						}
						if (observerItem) {
							var objProp;
							//observer换成watch
							if (typeItem.node.value.name == "Array" || typeItem.node.value.name == "Object") {
								//Array和Object换成深度监听
								var objExp_handle = t.objectProperty(t.identifier("handler"), observerItem.node.value);
								var objExp_deep = t.objectProperty(t.identifier("deep"), t.booleanLiteral(true));
								var properties = [objExp_handle, objExp_deep];
								var objExp = t.objectExpression(properties);
								objProp = t.objectProperty(t.identifier(propItemName), objExp);
							}else{
								//其他类型原样
								objProp = t.objectProperty(t.identifier(propItemName), observerItem.node.value);
							}
							observerItem.remove();
							vistors.watch.handle(objProp);
						}
						item.node.key.name = util.getValueAlias(item.node.key.name);
						vistors.props.handle(item.node);
					});
				}
				path.skip();
				break;
			case 'attached':
				//组件特有生命周期: attached-->beforeMount
				let newPath_a = clone(path);
				newPath_a.node.key.name = "beforeMount";
				vistors.lifeCycle.handle(newPath_a.node);
				path.skip();
				break;
			case 'detached':
				//组件特有生命周期: detached-->destroyed
				let newPath_d = clone(path);
				newPath_d.node.key.name = "destroyed";
				vistors.lifeCycle.handle(newPath_d.node);
				path.skip();
				break;
			case 'ready':
				//组件特有生命周期: ready-->mounted
				let newPath_r = clone(path);
				newPath_r.node.key.name = "mounted";
				vistors.lifeCycle.handle(newPath_r.node);
				path.skip();
				break;
			case 'moved':
				//组件特有生命周期: moved-->moved  //这个vue没有对应的生命周期
				let newPath_m = clone(path);
				newPath_m.node.key.name = "moved";
				vistors.lifeCycle.handle(newPath_m.node);
				path.skip();
				break;
			case 'pageLifetimes':
				//组件所在页面的生命周期函数pageLifetimes，原样放入生命周期内
				// show -- > onPageShow
				// hide -- > onPageHide
				// size -- > onPageResize
				var properties = path.node.value.properties;
				if (properties) {
					properties.forEach(function (item) {
						let name = item.key.name;
						switch (item.key.name) {
							case "show":
								name = "onPageShow";
								break;
							case "hide":
								name = "onPageHide";
								break;
							case "resize":
								name = "onPageResize";
								break;
						}
						item.key.name = name;
						vistors.lifeCycle.handle(item);
					});
				}
				path.skip();
				break;
			case 'lifetimes':
			//组件特有生命周期组lifetimes，不处理
			case 'behaviors':
			//组件的behaviors，原样放入生命周期内
			case 'externalClasses':
			//组件的externalClass自定义组件样式
			case 'relations':
			//组件的relations
			case 'options':
				//组件的options
				vistors.lifeCycle.handle(path.node);
				path.skip();
				break;
			case 'methods':
				//组件特有生命周期: methods
				var properties = path.node.value.properties;
				if (properties) {
					properties.forEach(function (item) {
						vistors.methods.handle(item);
					});
				}
				path.skip();
				break;
			default:
				vistors.lifeCycle.handle(path.node);
				break;
		}
	}
}

/**
 * 转换
 * @param {*} ast               ast
 * @param {*} _file_js          当前转换的文件路径
 * @param {*} isVueFile         是否为vue文件
 */
const componentConverter = function (ast, _file_js, isVueFile) {
	//清空上次的缓存
	declareStr = '';
	//
	file_js = _file_js;
	fileDir = nodePath.dirname(file_js);
	//
	vistors = {
		props: new Vistor(),
		data: new Vistor(),
		events: new Vistor(),
		computed: new Vistor(),
		components: new Vistor(),
		watch: new Vistor(),
		methods: new Vistor(),
		lifeCycle: new Vistor(),
	}

	traverse(ast, componentVistor);

	return {
		convertedJavascript: ast,
		vistors: vistors,
		declareStr, //定义的变量和导入的模块声明
	}
}

module.exports = componentConverter;
